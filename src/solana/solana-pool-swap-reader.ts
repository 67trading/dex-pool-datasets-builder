import type {
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
import { buildSolanaOrderingKey } from "./solana-ordering-key.js";
import { collectSignaturesInSlotRange } from "./solana-signature-pagination.js";
import {
  computeMintGrossDeltaRaw,
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
  onProgress?: DexBuildProgressHandler;
};

export type ReadSolanaAmmPoolSwapsWithQualityResult = {
  swaps: NormalizedPoolSwap[];
  quality: DexPoolQualitySummary;
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

  const { signatures, incompleteRangeCount } = await collectSignaturesInSlotRange({
    client,
    address: options.pool.poolAddress,
    fromSlot,
    toSlot,
    pageLimit,
    maxSignatures,
    failFast,
  });
  quality.incompleteBlockRanges += incompleteRangeCount;
  if (incompleteRangeCount > 0) quality.passed = false;

  const swaps: NormalizedPoolSwap[] = [];
  const seenSignatures = new Set<string>();
  let processed = 0;

  for (const sigInfo of signatures) {
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

    const amount0Raw = computeMintGrossDeltaRaw(
      tx.meta,
      options.pool.token0.address,
    );
    const amount1Raw = computeMintGrossDeltaRaw(
      tx.meta,
      options.pool.token1.address,
    );

    if (amount0Raw === 0n || amount1Raw === 0n) {
      // Program was invoked but neither mint moved (e.g. initialize,
      // set-config, or a route leg that touched this pool account
      // read-only) — not a swap of this pool.
      continue;
    }

    const amount0 = formatRawAmount(amount0Raw, options.pool.token0.decimals);
    const amount1 = formatRawAmount(amount1Raw, options.pool.token1.decimals);
    const priceToken1PerToken0 = amount1 / amount0;

    if (!Number.isFinite(priceToken1PerToken0) || priceToken1PerToken0 <= 0) {
      quality.invalidLogs += 1;
      quality.passed = false;
      if (failFast) {
        throw new Error(`SOLANA_SWAP_INVALID_PRICE:${sigInfo.signature}`);
      }
      continue;
    }

    swaps.push({
      chain: options.pool.chain,
      dex: options.pool.dex,
      poolAddress: options.pool.poolAddress,
      orderingKey: buildSolanaOrderingKey({
        slot: sigInfo.slot,
        transactionIndex: tx.transactionIndex ?? sigInfo.transactionIndex,
        signature: sigInfo.signature,
      }),
      txRef: sigInfo.signature,
      blockTimestamp: tx.blockTime,
      token0Symbol: options.pool.token0.symbol,
      token1Symbol: options.pool.token1.symbol,
      amount0,
      amount1,
      amount0Raw: amount0Raw.toString(),
      amount1Raw: amount1Raw.toString(),
      priceToken1PerToken0,
      priceToken0PerToken1: 1 / priceToken1PerToken0,
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

  return { swaps, quality };
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
 * without protocol-specific instruction decoding.
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
