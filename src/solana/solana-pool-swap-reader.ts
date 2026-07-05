import type {
  BackfillCompleteness,
  DexPoolCandleQualityFlags,
  DexPoolConfig,
  DexPoolQualitySummary,
  NormalizedPoolSwap,
} from "../types/dex-pool-dataset.types.js";
import type { DexBuildProgressHandler } from "../orchestrator/dex-build-progress.types.js";
import {
  createSolanaJsonRpcClient,
  type SolanaRpcFetch,
  type SolanaTransactionResult,
} from "./solana-json-rpc-client.js";
import { findSolanaAmmProgram } from "./solana-amm-program-registry.js";
import { NATIVE_SOL_MINT, SOLANA_INFRA_PROGRAM_IDS } from "./solana-infra-programs.js";
import { buildSolanaOrderingKey } from "./solana-ordering-key.js";
import { collectSignaturesInSlotRange } from "./solana-signature-pagination.js";
import {
  computeMintGrossDelta,
  formatRawAmount,
} from "./solana-token-balance-diff.js";

export type ReadSolanaAmmPoolSwapsWithQualityOptions = {
  pool: DexPoolConfig;
  rpcUrl: string;

  /**
   * Slot range, inclusive. Named fromBlock/toBlock to match the shared
   * ResolvedDexBuildConfig contract used by both chain families.
   */
  fromBlock: bigint;
  toBlock: bigint;

  fetchFn?: SolanaRpcFetch;
  failFast?: boolean;
  pageLimit?: number;
  maxSignatures?: number;
  maxScannedPages?: number;
  onProgress?: DexBuildProgressHandler;
};

export type ReadSolanaAmmPoolSwapsWithQualityResult = {
  swaps: NormalizedPoolSwap[];
  quality: DexPoolQualitySummary;
  backfillCompleteness: BackfillCompleteness;

  /**
   * True if intrablock ordering is guaranteed for every returned swap
   * (a real in-slot transactionIndex was available). False means at
   * least one swap fell back to a deterministic-but-not-necessarily-
   * chronological signature tiebreaker — see
   * DexPoolCandleQualityFlags.orderingApproximate.
   */
  intrablockOrderingPreserved: boolean;
};

export async function readSolanaAmmPoolSwapsWithQuality(
  options: ReadSolanaAmmPoolSwapsWithQualityOptions,
): Promise<ReadSolanaAmmPoolSwapsWithQualityResult> {
  if (options.pool.kind !== "SOLANA_AMM_STYLE") {
    throw new Error(`DEX_POOL_KIND_UNSUPPORTED:${options.pool.kind}`);
  }
  if (
    typeof options.pool.programId !== "string" ||
    options.pool.programId.length === 0
  ) {
    throw new Error(`SOLANA_POOL_PROGRAM_ID_MISSING:${options.pool.id}`);
  }

  const failFast = options.failFast ?? true;
  const pageLimit = options.pageLimit ?? 1000;
  const maxSignatures = options.maxSignatures ?? 200_000;
  const fromSlot = options.fromBlock;
  const toSlot = options.toBlock;
  const programId = options.pool.programId;
  const involvesNativeSol =
    options.pool.token0.address === NATIVE_SOL_MINT ||
    options.pool.token1.address === NATIVE_SOL_MINT;

  const client = createSolanaJsonRpcClient({
    rpcUrl: options.rpcUrl,
    fetchFn: options.fetchFn,
  });

  const quality: DexPoolQualitySummary = {
    passed: true,
    reorgConflicts: 0,
    invalidLogs: 0,
    duplicateLogs: 0,
    missingBlockTimestamps: 0,
    incompleteBlockRanges: 0,
    extremeWickCandles: 0,
    noTradeIntervals: 0,
  };

  options.onProgress?.({
    type: "logs_read_start",
    poolId: options.pool.id,
    chunks: 1,
    fromBlock: fromSlot.toString(),
    toBlock: toSlot.toString(),
  });

  const paginationResult = await collectSignaturesInSlotRange({
    client,
    address: options.pool.poolAddress,
    fromSlot,
    toSlot,
    pageLimit,
    maxSignatures,
    maxScannedPages: options.maxScannedPages,
    failFast,
  });
  quality.incompleteBlockRanges += paginationResult.incompleteRangeCount;
  if (paginationResult.incompleteRangeCount > 0) quality.passed = false;

  const swaps: NormalizedPoolSwap[] = [];
  const seenSignatures = new Set<string>();
  let processed = 0;
  let intrablockOrderingPreserved = true;

  for (const sigInfo of paginationResult.signatures) {
    processed += 1;

    if (seenSignatures.has(sigInfo.signature)) {
      quality.duplicateLogs += 1;
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
      quality.invalidLogs += 1;
      quality.passed = false;
      if (failFast) throw error;
      continue;
    }

    if (tx === null || tx.meta === null || tx.meta.err !== null) {
      continue;
    }

    if (!transactionInvokesPool(tx, programId, options.pool.poolAddress)) {
      continue;
    }

    if (
      tx.meta.preTokenBalances === undefined &&
      tx.meta.postTokenBalances === undefined
    ) {
      quality.invalidLogs += 1;
      quality.passed = false;
      if (failFast) {
        throw new Error(
          `SOLANA_SWAP_TOKEN_BALANCES_MISSING:${sigInfo.signature}`,
        );
      }
      continue;
    }

    if (tx.blockTime === null) {
      quality.missingBlockTimestamps += 1;
      quality.passed = false;
      if (failFast) {
        throw new Error(
          `SOLANA_SWAP_BLOCK_TIME_MISSING:${sigInfo.signature}`,
        );
      }
      continue;
    }

    const delta0 = computeMintGrossDelta(tx.meta, options.pool.token0.address);
    const delta1 = computeMintGrossDelta(tx.meta, options.pool.token1.address);

    if (delta0.grossRaw === 0n || delta1.grossRaw === 0n) {
      // Program was invoked but neither mint moved (e.g. initialize,
      // set-config, or a route leg that touched this pool account
      // read-only) — not a swap of this pool.
      continue;
    }

    const amount0 = formatRawAmount(delta0.grossRaw, options.pool.token0.decimals);
    const amount1 = formatRawAmount(delta1.grossRaw, options.pool.token1.decimals);
    const priceToken1PerToken0 = amount1 / amount0;

    if (!Number.isFinite(priceToken1PerToken0) || priceToken1PerToken0 <= 0) {
      quality.invalidLogs += 1;
      quality.passed = false;
      if (failFast) {
        throw new Error(`SOLANA_SWAP_INVALID_PRICE:${sigInfo.signature}`);
      }
      continue;
    }

    const transactionIndex = tx.transactionIndex ?? sigInfo.transactionIndex;
    const orderingApproximate = transactionIndex === undefined;
    if (orderingApproximate) intrablockOrderingPreserved = false;

    const swapQualityFlags = buildSwapQualityFlags({
      tx,
      programId,
      balanced: delta0.balanced && delta1.balanced,
      involvesNativeSol,
      orderingApproximate,
    });

    swaps.push({
      chain: options.pool.chain,
      dex: options.pool.dex,
      poolAddress: options.pool.poolAddress,
      orderingKey: buildSolanaOrderingKey({
        slot: sigInfo.slot,
        transactionIndex,
        signature: sigInfo.signature,
      }),
      txRef: sigInfo.signature,
      blockTimestamp: tx.blockTime,
      token0Symbol: options.pool.token0.symbol,
      token1Symbol: options.pool.token1.symbol,
      amount0,
      amount1,
      amount0Raw: delta0.grossRaw.toString(),
      amount1Raw: delta1.grossRaw.toString(),
      token0Decimals: options.pool.token0.decimals,
      token1Decimals: options.pool.token1.decimals,
      priceToken1PerToken0,
      priceToken0PerToken1: 1 / priceToken1PerToken0,
      attributionMode: "TX_GROSS_TOKEN_BALANCE_DIFF",
      qualityFlags: swapQualityFlags,
      raw: tx,
    });

    if (processed % 200 === 0) {
      options.onProgress?.({
        type: "swaps_decoded",
        poolId: options.pool.id,
        swaps: swaps.length,
      });
    }
  }

  swaps.sort((a, b) => {
    if (a.orderingKey < b.orderingKey) return -1;
    if (a.orderingKey > b.orderingKey) return 1;
    return 0;
  });

  options.onProgress?.({
    type: "swaps_decoded",
    poolId: options.pool.id,
    swaps: swaps.length,
  });

  return {
    swaps,
    quality,
    intrablockOrderingPreserved,
    backfillCompleteness: {
      requestedFromSlot: fromSlot.toString(),
      requestedToSlot: toSlot.toString(),
      scannedSignatureCount: paginationResult.scannedSignatureCount,
      collectedSignatureCount: paginationResult.signatures.length,
      rangeComplete: paginationResult.rangeComplete,
      stopReason: paginationResult.stopReason,
    },
  };
}

function buildSwapQualityFlags(input: {
  tx: SolanaTransactionResult;
  programId: string;
  balanced: boolean;
  involvesNativeSol: boolean;
  orderingApproximate: boolean;
}): DexPoolCandleQualityFlags {
  const otherProgramIds = collectOtherInvokedPrograms(input.tx, input.programId);
  const otherRecognizedAmm = [...otherProgramIds].some(
    (id) => findSolanaAmmProgram(id) !== undefined,
  );
  const otherNonInfra = [...otherProgramIds].some(
    (id) => !SOLANA_INFRA_PROGRAM_IDS.has(id),
  );

  return {
    poolVaultsNotVerified: true,
    ...(otherRecognizedAmm ? { multiAmmTransaction: true } : {}),
    ...(otherNonInfra ? { multiHopSuspected: true } : {}),
    ...(!input.balanced ? { sameMintExtraTransfers: true } : {}),
    ...(input.involvesNativeSol && !input.balanced
      ? { nativeSolRentAmbiguity: true }
      : {}),
    ...(input.orderingApproximate ? { orderingApproximate: true } : {}),
  };
}

function collectOtherInvokedPrograms(
  tx: SolanaTransactionResult,
  ownProgramId: string,
): Set<string> {
  const ids = new Set<string>();

  for (const instruction of tx.transaction.message.instructions) {
    if (instruction.programId !== ownProgramId) ids.add(instruction.programId);
  }
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const instruction of group.instructions) {
      if (instruction.programId !== ownProgramId) ids.add(instruction.programId);
    }
  }

  return ids;
}

/**
 * True only if some instruction that actually invokes `programId` also
 * lists `poolAddress` among its own accounts — i.e. this specific pool's
 * swap instruction ran, not merely that the program id appears somewhere
 * in the transaction's account list (routers commonly pass every
 * candidate AMM program id as a remaining/reference account even when a
 * given leg never touches it).
 *
 * Known remaining limitation: for a genuine multi-hop route where this
 * pool is one of several legs, the transaction-wide token-balance-diff
 * amounts (see solana-token-balance-diff.ts) reflect the whole route's
 * net movement of the pool's two mints, not this leg's amount alone —
 * there is no per-instruction balance snapshot to isolate it further
 * without protocol-specific instruction decoding. Flagged via
 * qualityFlags.multiAmmTransaction/multiHopSuspected when detected.
 */
function transactionInvokesPool(
  tx: SolanaTransactionResult,
  programId: string,
  poolAddress: string,
): boolean {
  const matches = (instruction: {
    programId: string;
    accounts?: string[];
  }): boolean =>
    instruction.programId === programId &&
    (instruction.accounts?.includes(poolAddress) ?? false);

  if (tx.transaction.message.instructions.some(matches)) return true;

  return (tx.meta?.innerInstructions ?? []).some((group) =>
    group.instructions.some(matches),
  );
}
