import { describe, expect, it } from "vitest";
import { readJupiterExecutionsWithQuality } from "./jupiter-execution-reader.js";
import { JUPITER_V6_PROGRAM_ID } from "../solana/solana-amm-program-registry.js";
import type { SolanaRpcFetch } from "../solana/solana-json-rpc-client.js";

const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RAY_MINT = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

function tokenBalance(accountIndex: number, mint: string, owner: string, amount: string) {
  return {
    accountIndex,
    mint,
    owner,
    uiTokenAmount: { amount, decimals: 6, uiAmount: null, uiAmountString: "" },
  };
}

function fetchForTx(signature: string, slot: number, tx: unknown): SolanaRpcFetch {
  let sigCallCount = 0;

  return async (_url, init) => {
    const body = JSON.parse(init.body as string) as { method: string };

    if (body.method === "getSignaturesForAddress") {
      sigCallCount += 1;
      const result =
        sigCallCount === 1
          ? [{ signature, slot, err: null, blockTime: 1_700_000_000, confirmationStatus: "finalized" }]
          : [];
      return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result }) };
    }
    if (body.method === "getTransaction") {
      return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: tx }) };
    }
    if (body.method === "getAccountInfo") {
      // Only used for decimals resolution; return null so callers fall
      // back to undefined decimals rather than making assertions on it.
      return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: null } }) };
    }
    throw new Error(`unexpected method ${body.method}`);
  };
}

function baseTx(overrides: {
  accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean }>;
  preTokenBalances: ReturnType<typeof tokenBalance>[];
  postTokenBalances: ReturnType<typeof tokenBalance>[];
  innerInstructions?: unknown[];
}) {
  return {
    slot: 500,
    blockTime: 1_700_000_000,
    transactionIndex: 3,
    meta: {
      err: null,
      fee: 5000,
      preBalances: overrides.accountKeys.map(() => 1_000_000_000),
      postBalances: overrides.accountKeys.map(() => 999_995_000),
      preTokenBalances: overrides.preTokenBalances,
      postTokenBalances: overrides.postTokenBalances,
      innerInstructions: overrides.innerInstructions ?? [],
      logMessages: [],
    },
    transaction: {
      signatures: ["sig"],
      message: {
        accountKeys: overrides.accountKeys,
        instructions: [{ programId: JUPITER_V6_PROGRAM_ID, accounts: [], data: "" }],
      },
    },
  };
}

describe("readJupiterExecutionsWithQuality — resolution confidence model", () => {
  it("resolves a plain single-signer SPL-to-SPL swap as HIGH confidence", async () => {
    const tx = baseTx({
      accountKeys: [{ pubkey: "trader", signer: true, writable: true }],
      preTokenBalances: [tokenBalance(0, RAY_MINT, "trader", "1000000")],
      postTokenBalances: [tokenBalance(0, RAY_MINT, "trader", "0")],
    });
    // trader also gains USDC
    tx.meta.preTokenBalances.push(tokenBalance(1, USDC_MINT, "trader", "0"));
    tx.meta.postTokenBalances.push(tokenBalance(1, USDC_MINT, "trader", "700000"));

    const result = await readJupiterExecutionsWithQuality({
      rpcUrl: "http://fake",
      fromBlock: 500n,
      toBlock: 500n,
      resolveDecimals: false,
      fetchFn: fetchForTx("sig", 500, tx),
    });

    expect(result.executions).toHaveLength(1);
    const record = result.executions[0]!;
    expect(record.inputMint).toBe(RAY_MINT);
    expect(record.outputMint).toBe(USDC_MINT);
    expect(record.resolutionConfidence).toBe("HIGH");
    expect(record.resolutionMethod).toBe("SIGNER_TOKEN_BALANCE_DIFF");
    expect(record.qualityFlags).toEqual({});
  });

  it("downgrades to LOW confidence and flags multiSigner/feePayerNotTokenOwner for a multi-signer transaction", async () => {
    const tx = baseTx({
      accountKeys: [
        { pubkey: "trader", signer: true, writable: true },
        { pubkey: "cosigner", signer: true, writable: false },
      ],
      preTokenBalances: [
        tokenBalance(0, RAY_MINT, "trader", "1000000"),
        tokenBalance(1, USDC_MINT, "trader", "0"),
      ],
      postTokenBalances: [
        tokenBalance(0, RAY_MINT, "trader", "0"),
        tokenBalance(1, USDC_MINT, "trader", "700000"),
      ],
    });

    const result = await readJupiterExecutionsWithQuality({
      rpcUrl: "http://fake",
      fromBlock: 500n,
      toBlock: 500n,
      resolveDecimals: false,
      fetchFn: fetchForTx("sig", 500, tx),
    });

    const record = result.executions[0]!;
    expect(record.resolutionConfidence).toBe("LOW");
    expect(record.qualityFlags.multiSigner).toBe(true);
    expect(record.qualityFlags.feePayerNotTokenOwner).toBe(true);
  });

  it("flags nativeSolRentAmbiguity and downgrades to MEDIUM when native SOL is the input/output", async () => {
    const tx = baseTx({
      accountKeys: [{ pubkey: "trader", signer: true, writable: true }],
      preTokenBalances: [tokenBalance(0, USDC_MINT, "trader", "0")],
      postTokenBalances: [tokenBalance(0, USDC_MINT, "trader", "700000")],
    });
    // native SOL delta: trader's lamports drop by 1 SOL beyond the fee.
    tx.meta.preBalances = [2_000_000_000];
    tx.meta.postBalances = [1_000_000_000 - 5000];

    const result = await readJupiterExecutionsWithQuality({
      rpcUrl: "http://fake",
      fromBlock: 500n,
      toBlock: 500n,
      resolveDecimals: false,
      fetchFn: fetchForTx("sig", 500, tx),
    });

    const record = result.executions[0]!;
    expect(record.inputMint).toBe(NATIVE_SOL_MINT);
    expect(record.outputMint).toBe(USDC_MINT);
    expect(record.resolutionConfidence).toBe("MEDIUM");
    expect(record.resolutionMethod).toBe("FEE_PAYER_NATIVE_SOL_ADJUSTED");
    expect(record.qualityFlags.nativeSolRentAmbiguity).toBe(true);
  });

  it("flags multiplePositiveDeltas/multipleNegativeDeltas as LOW confidence and reports every mint in otherMintDeltasRaw", async () => {
    const tx = baseTx({
      accountKeys: [{ pubkey: "trader", signer: true, writable: true }],
      preTokenBalances: [
        tokenBalance(0, RAY_MINT, "trader", "1000000"),
        tokenBalance(1, BONK_MINT, "trader", "1000000"),
        tokenBalance(2, USDC_MINT, "trader", "0"),
      ],
      postTokenBalances: [
        tokenBalance(0, RAY_MINT, "trader", "0"),
        tokenBalance(1, BONK_MINT, "trader", "0"),
        tokenBalance(2, USDC_MINT, "trader", "700000"),
      ],
    });

    const result = await readJupiterExecutionsWithQuality({
      rpcUrl: "http://fake",
      fromBlock: 500n,
      toBlock: 500n,
      resolveDecimals: false,
      fetchFn: fetchForTx("sig", 500, tx),
    });

    const record = result.executions[0]!;
    expect(record.resolutionConfidence).toBe("LOW");
    expect(record.qualityFlags.multipleNegativeDeltas).toBe(true);
    expect(record.otherMintDeltasRaw).toHaveLength(1);
  });

  it("dedups recognizedAmmPrograms and marks routeLegsApproximate", async () => {
    const tx = baseTx({
      accountKeys: [{ pubkey: "trader", signer: true, writable: true }],
      preTokenBalances: [tokenBalance(0, RAY_MINT, "trader", "1000000")],
      postTokenBalances: [tokenBalance(0, RAY_MINT, "trader", "0")],
      innerInstructions: [
        {
          index: 0,
          instructions: [
            { programId: RAYDIUM_AMM_V4, accounts: [], data: "" },
            { programId: RAYDIUM_AMM_V4, accounts: [], data: "" },
            { programId: "SomeUnrecognizedProgram1111111111111111111", accounts: [], data: "" },
          ],
        },
      ],
    });
    tx.meta.preTokenBalances.push(tokenBalance(1, USDC_MINT, "trader", "0"));
    tx.meta.postTokenBalances.push(tokenBalance(1, USDC_MINT, "trader", "700000"));

    const result = await readJupiterExecutionsWithQuality({
      rpcUrl: "http://fake",
      fromBlock: 500n,
      toBlock: 500n,
      resolveDecimals: false,
      fetchFn: fetchForTx("sig", 500, tx),
    });

    const record = result.executions[0]!;
    expect(record.recognizedAmmPrograms).toEqual([
      { programId: RAYDIUM_AMM_V4, dex: "raydium", label: "Raydium AMM v4" },
    ]);
    expect(record.routeLegsApproximate).toBe(true);
  });
});
