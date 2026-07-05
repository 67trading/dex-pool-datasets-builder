import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSolanaAmmPoolSwapsWithQuality } from "./solana-pool-swap-reader.js";
import type { DexPoolConfig } from "../types/dex-pool-dataset.types.js";
import type { SolanaRpcFetch } from "./solana-json-rpc-client.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Frozen response from a real, live mainnet transaction (captured 2026-07),
 * used to regression-test the token-balance-diff decoding against ground
 * truth rather than only synthetic fixtures. See __fixtures__ for details.
 */
const fixture = JSON.parse(
  readFileSync(join(here, "__fixtures__/raydium-ray-usdc-swap-tx.json"), "utf8"),
) as { result: unknown };

const SIGNATURE =
  "2ZJVP4y77nYVupBMhKk3H5y6kPsN5qvySe1kmcnQGEkYh4PwoXqYK65d45F3K7aLg1uMVkgVqfwaRgsi8SjQi11n";
const SLOT = 430949599;

const pool: DexPoolConfig = {
  id: "solana-raydium-ray-usdc",
  chain: "solana",
  dex: "raydium",
  kind: "SOLANA_AMM_STYLE",
  poolAddress: "6UmmUiYoBjSrhakAobJw8BvkmJtDVxaeBtbt7rxWo1mg",
  programId: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  token0: { symbol: "RAY", address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", decimals: 6 },
  token1: { symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  baseToken: "token0",
  quoteToken: "token1",
  startBlock: "430949599",
};

function singleSignatureFetch(input: {
  signature: string;
  slot: number;
  blockTime: number;
  transactionIndex?: number;
  tx: unknown;
}): SolanaRpcFetch {
  let sigCallCount = 0;

  return async (_url, init) => {
    const body = JSON.parse(init.body as string) as { method: string };

    if (body.method === "getSignaturesForAddress") {
      sigCallCount += 1;
      const result =
        sigCallCount === 1
          ? [
              {
                signature: input.signature,
                slot: input.slot,
                err: null,
                blockTime: input.blockTime,
                confirmationStatus: "finalized",
                ...(input.transactionIndex !== undefined
                  ? { transactionIndex: input.transactionIndex }
                  : {}),
              },
            ]
          : [];
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
      };
    }

    if (body.method === "getTransaction") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: input.tx }),
      };
    }

    throw new Error(`unexpected method ${body.method}`);
  };
}

describe("readSolanaAmmPoolSwapsWithQuality (live fixture regression)", () => {
  it("decodes a real multi-hop Raydium AMM v4 + CLMM transaction, flagging the multi-hop attribution caveat", async () => {
    const fixtureResult = fixture.result as { blockTime: number; transactionIndex: number };

    const result = await readSolanaAmmPoolSwapsWithQuality({
      pool,
      rpcUrl: "http://fake",
      fromBlock: BigInt(SLOT),
      toBlock: BigInt(SLOT),
      fetchFn: singleSignatureFetch({
        signature: SIGNATURE,
        slot: SLOT,
        blockTime: fixtureResult.blockTime,
        transactionIndex: fixtureResult.transactionIndex,
        tx: fixture.result,
      }),
    });

    expect(result.swaps).toHaveLength(1);
    const swap = result.swaps[0]!;
    expect(swap.txRef).toBe(SIGNATURE);
    expect(swap.amount0).toBeCloseTo(169.938);
    expect(swap.amount1).toBeCloseTo(120.754344);
    expect(swap.priceToken1PerToken0).toBeCloseTo(0.7105788228648096);
    expect(swap.orderingKey).toBe(`00000000000${SLOT}:00001300:${SIGNATURE}`);
    expect(swap.attributionMode).toBe("TX_GROSS_TOKEN_BALANCE_DIFF");
    expect(result.quality.passed).toBe(true);

    // This transaction is a real 2-hop route (Raydium AMM v4 -> Raydium
    // CLMM) — must NOT be presented as an unambiguous single-pool swap.
    expect(swap.qualityFlags?.multiAmmTransaction).toBe(true);
    expect(swap.qualityFlags?.multiHopSuspected).toBe(true);
    expect(swap.qualityFlags?.poolVaultsNotVerified).toBe(true);
    expect(swap.qualityFlags?.sameMintExtraTransfers).toBeUndefined();

    expect(result.intrablockOrderingPreserved).toBe(true);
    expect(result.backfillCompleteness.rangeComplete).toBe(true);
  });

  it("flags orderingApproximate and sets intrablockOrderingPreserved=false when no in-slot transactionIndex is available", async () => {
    const syntheticTx = {
      slot: SLOT,
      blockTime: 1_700_000_000,
      // no transactionIndex field at all — simulates an RPC provider that
      // doesn't return one, forcing the signature-only ordering fallback.
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1_000_000_000],
        postBalances: [999_995_000],
        preTokenBalances: [
          { accountIndex: 1, mint: pool.token0.address, uiTokenAmount: { amount: "1000000000", decimals: 6, uiAmount: null, uiAmountString: "" } },
          { accountIndex: 2, mint: pool.token1.address, uiTokenAmount: { amount: "0", decimals: 6, uiAmount: null, uiAmountString: "" } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint: pool.token0.address, uiTokenAmount: { amount: "900000000", decimals: 6, uiAmount: null, uiAmountString: "" } },
          { accountIndex: 2, mint: pool.token1.address, uiTokenAmount: { amount: "70000000", decimals: 6, uiAmount: null, uiAmountString: "" } },
        ],
        innerInstructions: [],
        logMessages: [],
      },
      transaction: {
        signatures: ["synthetic-sig-no-tx-index"],
        message: {
          accountKeys: ["trader", pool.poolAddress],
          instructions: [
            { programId: pool.programId, accounts: [pool.poolAddress], data: "" },
          ],
        },
      },
    };

    const result = await readSolanaAmmPoolSwapsWithQuality({
      pool,
      rpcUrl: "http://fake",
      fromBlock: BigInt(SLOT),
      toBlock: BigInt(SLOT),
      fetchFn: singleSignatureFetch({
        signature: "synthetic-sig-no-tx-index",
        slot: SLOT,
        blockTime: 1_700_000_000,
        tx: syntheticTx,
      }),
    });

    expect(result.swaps).toHaveLength(1);
    expect(result.swaps[0]!.qualityFlags?.orderingApproximate).toBe(true);
    expect(result.intrablockOrderingPreserved).toBe(false);
    expect(result.swaps[0]!.orderingKey).toBe(
      `00000000000${SLOT}:00000000:synthetic-sig-no-tx-index`,
    );
  });
});
