import type { Timeframe } from "../contracts/timeframe.js";
import { getTimeframeMs } from "../contracts/timeframe.js";
import type {
  DexPoolCandle,
  DexPoolConfig,
  DexPoolSwapRawAudit,
  NormalizedPoolSwap,
} from "../types/dex-pool-dataset.types.js";
import { buildReplaySymbol } from "../registry/pool-registry.js";

export type BuildPoolCandlesOptions = {
  pool: DexPoolConfig;
  swaps: NormalizedPoolSwap[];
  timeframe: Timeframe;
};

export function buildCandlesFromSwaps(
  options: BuildPoolCandlesOptions,
): DexPoolCandle[] {
  const timeframeMs = getTimeframeMs(options.timeframe);
  const sorted = sortSwaps(options.swaps);
  assertUniqueSwapEvents(sorted);
  const buckets = new Map<number, NormalizedPoolSwap[]>();

  for (const swap of sorted) {
    validateSwap(swap);
    const bucketOpenTime =
      Math.floor((swap.blockTimestamp * 1000) / timeframeMs) * timeframeMs;
    const bucket = buckets.get(bucketOpenTime) ?? [];
    bucket.push(swap);
    buckets.set(bucketOpenTime, bucket);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([openTime, bucket]) =>
      buildCandleFromBucket(options.pool, options.timeframe, openTime, bucket),
    );
}

/**
 * Sorts purely by the chain-agnostic orderingKey string.
 *
 * Adapters (EVM: block+txIndex+logIndex, Solana: slot+txIndex+ixRef) are
 * responsible for constructing orderingKey such that lexicographic string
 * comparison equals chronological event order.
 */
export function sortSwaps(swaps: NormalizedPoolSwap[]): NormalizedPoolSwap[] {
  return [...swaps].sort((a, b) => {
    if (a.orderingKey < b.orderingKey) return -1;
    if (a.orderingKey > b.orderingKey) return 1;
    return 0;
  });
}

function buildCandleFromBucket(
  pool: DexPoolConfig,
  timeframe: Timeframe,
  openTime: number,
  bucket: NormalizedPoolSwap[],
): DexPoolCandle {
  const first = bucket[0];
  const last = bucket.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error(`EMPTY_SWAP_BUCKET:${openTime}`);
  }

  const prices = bucket.map((swap) => priceForPoolDirection(pool, swap));
  const baseAmount = bucket.reduce(
    (sum, swap) => sum + Math.abs(amountForToken(pool.baseToken, swap)),
    0,
  );
  const quoteAmount = bucket.reduce(
    (sum, swap) => sum + Math.abs(amountForToken(pool.quoteToken, swap)),
    0,
  );

  return {
    venueType: "DEX_POOL",
    chain: pool.chain,
    dex: pool.dex,
    poolAddress: pool.poolAddress,
    baseSymbol: pool[pool.baseToken].symbol.toUpperCase(),
    quoteSymbol: pool[pool.quoteToken].symbol.toUpperCase(),
    symbol: buildReplaySymbol(pool),
    timeframe,
    openTime,
    closeTime: openTime + getTimeframeMs(timeframe) - 1,
    open: prices[0]!,
    high: prices.reduce(
      (max, price) => Math.max(max, price),
      Number.NEGATIVE_INFINITY,
    ),
    low: prices.reduce(
      (min, price) => Math.min(min, price),
      Number.POSITIVE_INFINITY,
    ),
    close: prices.at(-1)!,
    volumeBase: baseAmount,
    volumeQuote: quoteAmount,
    tradeCount: bucket.length,
    source: {
      mode: "ONCHAIN_POOL_EVENTS",
      fromOrderingKey: first.orderingKey,
      toOrderingKey: last.orderingKey,
      txRefRange: [first.txRef, last.txRef],
      rawSwapRange: {
        first: buildRawSwapAudit(first),
        last: buildRawSwapAudit(last),
      },
    },
    qualityFlags: bucket.length <= 1 ? { lowTradeCount: true } : {},
  };
}

function assertUniqueSwapEvents(swaps: NormalizedPoolSwap[]): void {
  const seen = new Set<string>();
  for (const swap of swaps) {
    if (seen.has(swap.orderingKey)) {
      throw new Error(`DUPLICATE_SWAP_EVENT:${swap.orderingKey}`);
    }
    seen.add(swap.orderingKey);
  }
}

export function priceForPoolDirection(
  pool: DexPoolConfig,
  swap: NormalizedPoolSwap,
): number {
  const price =
    pool.baseToken === "token0" && pool.quoteToken === "token1"
      ? swap.priceToken1PerToken0
      : swap.priceToken0PerToken1;
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`INVALID_DERIVED_PRICE:${swap.txRef}:${swap.orderingKey}`);
  }
  return price;
}

function amountForToken(
  token: "token0" | "token1",
  swap: NormalizedPoolSwap,
): number {
  return token === "token0" ? swap.amount0 : swap.amount1;
}

function validateSwap(swap: NormalizedPoolSwap): void {
  if (!Number.isFinite(swap.blockTimestamp) || swap.blockTimestamp <= 0) {
    throw new Error(
      `MISSING_BLOCK_TIMESTAMP:${swap.txRef}:${swap.orderingKey}`,
    );
  }
  if (swap.orderingKey.length === 0) {
    throw new Error(`INVALID_ORDERING_KEY:${swap.txRef}`);
  }
  if (!Number.isFinite(swap.amount0) || !Number.isFinite(swap.amount1)) {
    throw new Error(`INVALID_SWAP_AMOUNT:${swap.txRef}:${swap.orderingKey}`);
  }
  if (
    !Number.isFinite(swap.priceToken1PerToken0) ||
    swap.priceToken1PerToken0 <= 0 ||
    !Number.isFinite(swap.priceToken0PerToken1) ||
    swap.priceToken0PerToken1 <= 0
  ) {
    throw new Error(
      `INVALID_DERIVED_PRICE:${swap.txRef}:${swap.orderingKey}`,
    );
  }
}

function buildRawSwapAudit(swap: NormalizedPoolSwap): DexPoolSwapRawAudit {
  return {
    txRef: swap.txRef,
    orderingKey: swap.orderingKey,
    ...(swap.amount0Raw !== undefined ? { amount0Raw: swap.amount0Raw } : {}),
    ...(swap.amount1Raw !== undefined ? { amount1Raw: swap.amount1Raw } : {}),
    ...(swap.sqrtPriceX96Raw !== undefined
      ? { sqrtPriceX96Raw: swap.sqrtPriceX96Raw }
      : {}),
  } satisfies DexPoolSwapRawAudit;
}
