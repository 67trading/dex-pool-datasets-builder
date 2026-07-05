import {
  createSolanaJsonRpcClient,
  type SolanaRpcFetch,
  type SolanaTransactionResult,
  type SolanaTokenBalance,
} from "../solana/solana-json-rpc-client.js";
import { collectSignaturesInSlotRange } from "../solana/solana-signature-pagination.js";
import {
  findSolanaAmmProgram,
  JUPITER_V6_PROGRAM_ID,
} from "../solana/solana-amm-program-registry.js";
import { NATIVE_SOL_MINT } from "../solana/solana-infra-programs.js";
import { fetchMintDecimals } from "../solana/solana-mint-metadata.js";
import type { BackfillCompleteness } from "../types/dex-pool-dataset.types.js";
import type {
  JupiterExecutionQualityFlags,
  JupiterExecutionQualitySummary,
  JupiterExecutionRecord,
  JupiterExecutionResolutionConfidence,
  JupiterExecutionResolutionMethod,
  JupiterRecognizedAmmProgram,
} from "./jupiter-execution.types.js";

export type ReadJupiterExecutionsOptions = {
  rpcUrl: string;
  fromBlock: bigint;
  toBlock: bigint;
  fetchFn?: SolanaRpcFetch;
  failFast?: boolean;
  pageLimit?: number;
  maxSignatures?: number;
  maxScannedPages?: number;
  resolveDecimals?: boolean;
  onProgress?: (event: { type: "executions_decoded"; count: number }) => void;
};

export type ReadJupiterExecutionsResult = {
  executions: JupiterExecutionRecord[];
  quality: JupiterExecutionQualitySummary;
  backfillCompleteness: BackfillCompleteness;
};

export async function readJupiterExecutionsWithQuality(
  options: ReadJupiterExecutionsOptions,
): Promise<ReadJupiterExecutionsResult> {
  const failFast = options.failFast ?? false;
  const resolveDecimals = options.resolveDecimals ?? true;

  const client = createSolanaJsonRpcClient({
    rpcUrl: options.rpcUrl,
    fetchFn: options.fetchFn,
  });

  const quality: JupiterExecutionQualitySummary = {
    passed: true,
    duplicateSignatures: 0,
    invalidTransactions: 0,
    missingBlockTimestamps: 0,
    noInputOutputResolved: 0,
    incompleteRanges: 0,
  };

  const paginationResult = await collectSignaturesInSlotRange({
    client,
    address: JUPITER_V6_PROGRAM_ID,
    fromSlot: options.fromBlock,
    toSlot: options.toBlock,
    pageLimit: options.pageLimit,
    maxSignatures: options.maxSignatures,
    maxScannedPages: options.maxScannedPages,
    failFast,
  });
  quality.incompleteRanges += paginationResult.incompleteRangeCount;
  if (paginationResult.incompleteRangeCount > 0) quality.passed = false;
  if (!paginationResult.rangeComplete) {
    // Not a guaranteed-full backfill of the requested slot range — see
    // manifest.backfillCompleteness. A consumer checking quality.passed
    // alone must not be able to mistake this for a complete dataset.
    quality.incompleteRanges += 1;
    quality.passed = false;
  }

  const executions: JupiterExecutionRecord[] = [];
  const seenSignatures = new Set<string>();
  const decimalsCache = new Map<string, number>();

  async function getDecimals(mint: string): Promise<number | undefined> {
    if (!resolveDecimals) return undefined;
    if (mint === NATIVE_SOL_MINT) return 9;
    const cached = decimalsCache.get(mint);
    if (cached !== undefined) return cached;
    try {
      const decimals = await fetchMintDecimals(client, mint);
      decimalsCache.set(mint, decimals);
      return decimals;
    } catch {
      return undefined;
    }
  }

  for (const sigInfo of paginationResult.signatures) {
    if (seenSignatures.has(sigInfo.signature)) {
      quality.duplicateSignatures += 1;
      quality.passed = false;
      continue;
    }
    seenSignatures.add(sigInfo.signature);

    if (sigInfo.err !== null && sigInfo.err !== undefined) {
      continue;
    }

    let tx: SolanaTransactionResult | null;
    try {
      tx = await client.getTransaction(sigInfo.signature);
    } catch (error) {
      quality.invalidTransactions += 1;
      quality.passed = false;
      if (failFast) throw error;
      continue;
    }

    if (tx === null || tx.meta === null || tx.meta.err !== null) {
      continue;
    }

    if (tx.blockTime === null) {
      quality.missingBlockTimestamps += 1;
      quality.passed = false;
      continue;
    }

    const signer = accountKeyToString(tx.transaction.message.accountKeys[0]);
    if (signer === undefined) {
      quality.invalidTransactions += 1;
      quality.passed = false;
      continue;
    }

    const mintDeltas = computeSignerMintDeltas(tx, signer);

    const negatives = mintDeltas.filter((d) => d.deltaRaw < 0n);
    const positives = mintDeltas.filter((d) => d.deltaRaw > 0n);

    if (negatives.length === 0 || positives.length === 0) {
      quality.noInputOutputResolved += 1;
      quality.passed = false;
      continue;
    }

    negatives.sort((a, b) => (a.deltaRaw < b.deltaRaw ? -1 : 1));
    positives.sort((a, b) => (b.deltaRaw < a.deltaRaw ? -1 : 1));

    const input = negatives[0]!;
    const output = positives[0]!;

    const recognizedAmmPrograms = collectRecognizedAmmPrograms(tx);

    const [inputDecimals, outputDecimals] = await Promise.all([
      getDecimals(input.mint),
      getDecimals(output.mint),
    ]);

    const signerCount = countSigners(tx.transaction.message.accountKeys);
    const multiSigner = signerCount > 1;
    const involvesNativeSol =
      input.mint === NATIVE_SOL_MINT || output.mint === NATIVE_SOL_MINT;

    const qualityFlags: JupiterExecutionQualityFlags = {
      ...(multiSigner ? { multiSigner: true, feePayerNotTokenOwner: true } : {}),
      ...(involvesNativeSol ? { nativeSolRentAmbiguity: true } : {}),
      ...(negatives.length > 1 ? { multipleNegativeDeltas: true } : {}),
      ...(positives.length > 1 ? { multiplePositiveDeltas: true } : {}),
    };

    const resolutionMethod: JupiterExecutionResolutionMethod = involvesNativeSol
      ? "FEE_PAYER_NATIVE_SOL_ADJUSTED"
      : "SIGNER_TOKEN_BALANCE_DIFF";

    const resolutionConfidence: JupiterExecutionResolutionConfidence =
      multiSigner || negatives.length > 1 || positives.length > 1
        ? "LOW"
        : involvesNativeSol
          ? "MEDIUM"
          : "HIGH";

    executions.push({
      signature: sigInfo.signature,
      slot: sigInfo.slot,
      blockTime: tx.blockTime,
      transactionIndex: tx.transactionIndex ?? sigInfo.transactionIndex,
      signer,
      instructionName: extractInstructionName(tx),
      inputMint: input.mint,
      inputAmountRaw: (-input.deltaRaw).toString(),
      inputDecimals,
      outputMint: output.mint,
      outputAmountRaw: output.deltaRaw.toString(),
      outputDecimals,
      otherMintDeltasRaw: mintDeltas
        .filter((d) => d !== input && d !== output)
        .map((d) => ({ mint: d.mint, deltaRaw: d.deltaRaw.toString() })),
      recognizedAmmPrograms,
      routeLegsApproximate: true,
      resolutionConfidence,
      resolutionMethod,
      qualityFlags,
    });

    if (executions.length % 100 === 0) {
      options.onProgress?.({ type: "executions_decoded", count: executions.length });
    }
  }

  options.onProgress?.({ type: "executions_decoded", count: executions.length });

  executions.sort((a, b) => {
    if (a.slot !== b.slot) return a.slot - b.slot;
    return (a.transactionIndex ?? 0) - (b.transactionIndex ?? 0);
  });

  return {
    executions,
    quality,
    backfillCompleteness: {
      requestedFromSlot: options.fromBlock.toString(),
      requestedToSlot: options.toBlock.toString(),
      scannedSignatureCount: paginationResult.scannedSignatureCount,
      collectedSignatureCount: paginationResult.signatures.length,
      rangeComplete: paginationResult.rangeComplete,
      stopReason: paginationResult.stopReason,
    },
  };
}

function accountKeyToString(
  key: string | { pubkey: string } | undefined,
): string | undefined {
  if (key === undefined) return undefined;
  return typeof key === "string" ? key : key.pubkey;
}

function countSigners(
  accountKeys: Array<string | { pubkey: string; signer?: boolean; writable?: boolean }>,
): number {
  return accountKeys.filter(
    (key) => typeof key !== "string" && key.signer === true,
  ).length;
}

function computeSignerMintDeltas(
  tx: SolanaTransactionResult,
  signer: string,
): Array<{ mint: string; deltaRaw: bigint }> {
  const meta = tx.meta!;
  const pre = indexSignerBalances(meta.preTokenBalances, signer);
  const post = indexSignerBalances(meta.postTokenBalances, signer);

  const byMint = new Map<string, bigint>();
  const mints = new Set<string>([...pre.keys(), ...post.keys()]);

  for (const mint of mints) {
    const delta = (post.get(mint) ?? 0n) - (pre.get(mint) ?? 0n);
    if (delta !== 0n) byMint.set(mint, delta);
  }

  const feePayerIsSigner = accountKeyToString(tx.transaction.message.accountKeys[0]) === signer;
  if (feePayerIsSigner) {
    const preLamports = meta.preBalances[0];
    const postLamports = meta.postBalances[0];
    if (preLamports !== undefined && postLamports !== undefined) {
      const nativeDelta = BigInt(postLamports) - BigInt(preLamports) + BigInt(meta.fee);
      if (nativeDelta !== 0n) {
        byMint.set(NATIVE_SOL_MINT, (byMint.get(NATIVE_SOL_MINT) ?? 0n) + nativeDelta);
      }
    }
  }

  return Array.from(byMint.entries()).map(([mint, deltaRaw]) => ({ mint, deltaRaw }));
}

function indexSignerBalances(
  balances: SolanaTokenBalance[] | undefined,
  signer: string,
): Map<string, bigint> {
  const map = new Map<string, bigint>();
  for (const balance of balances ?? []) {
    if (balance.owner !== signer) continue;
    const existing = map.get(balance.mint) ?? 0n;
    map.set(balance.mint, existing + BigInt(balance.uiTokenAmount.amount));
  }
  return map;
}

function collectRecognizedAmmPrograms(
  tx: SolanaTransactionResult,
): JupiterRecognizedAmmProgram[] {
  const seen = new Set<string>();
  const programs: JupiterRecognizedAmmProgram[] = [];

  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const instruction of group.instructions) {
      const programId = instruction.programId;
      if (programId === JUPITER_V6_PROGRAM_ID || seen.has(programId)) continue;
      const registryEntry = findSolanaAmmProgram(programId);
      if (registryEntry === undefined) continue;
      seen.add(programId);
      programs.push({ programId, dex: registryEntry.dex, label: registryEntry.label });
    }
  }

  return programs;
}

function extractInstructionName(tx: SolanaTransactionResult): string | undefined {
  const logs = tx.meta?.logMessages ?? [];
  const jupiterInvokeIndex = logs.findIndex((line) =>
    line.startsWith(`Program ${JUPITER_V6_PROGRAM_ID} invoke`),
  );
  if (jupiterInvokeIndex === -1) return undefined;

  for (let i = jupiterInvokeIndex + 1; i < logs.length; i += 1) {
    const line = logs[i]!;
    if (line.startsWith("Program log: Instruction: ")) {
      return line.slice("Program log: Instruction: ".length);
    }
    if (line.startsWith(`Program ${JUPITER_V6_PROGRAM_ID} consumed`)) break;
  }
  return undefined;
}
