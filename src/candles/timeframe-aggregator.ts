import type { Timeframe } from "../contracts/timeframe.js";
import { getTimeframeMs } from "../contracts/timeframe.js";
import type { DexPoolCandle } from "../types/dex-pool-dataset.types.js";

export function aggregateDexPoolCandles(
  candles: DexPoolCandle[],
  targetTimeframe: Timeframe,
): DexPoolCandle[] {
  const intervalMs = getTimeframeMs(targetTimeframe);
  const buckets = new Map<number, DexPoolCandle[]>();

  for (const candle of [...candles].sort((a, b) => a.openTime - b.openTime)) {
    const openTime = Math.floor(candle.openTime / intervalMs) * intervalMs;
    const bucket = buckets.get(openTime) ?? [];
    bucket.push(candle);
    buckets.set(openTime, bucket);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([openTime, bucket]) =>
      aggregateBucket(openTime, intervalMs, targetTimeframe, bucket),
    );
}

function aggregateBucket(
  openTime: number,
  intervalMs: number,
  targetTimeframe: Timeframe,
  bucket: DexPoolCandle[],
): DexPoolCandle {
  const first = bucket[0];
  const last = bucket.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error(`EMPTY_AGGREGATION_BUCKET:${openTime}`);
  }

  const hasNoTradeInterval = bucket.some(
    (candle) => candle.qualityFlags.noTradeInterval,
  );
  const hasFillForwarded = bucket.some(
    (candle) => candle.qualityFlags.fillForwarded,
  );

  return {
    ...first,
    timeframe: targetTimeframe,
    openTime,
    closeTime: openTime + intervalMs - 1,
    open: first.open,
    high: bucket.reduce(
      (max, candle) => Math.max(max, candle.high),
      Number.NEGATIVE_INFINITY,
    ),
    low: bucket.reduce(
      (min, candle) => Math.min(min, candle.low),
      Number.POSITIVE_INFINITY,
    ),
    close: last.close,
    volumeBase: bucket.reduce((sum, candle) => sum + candle.volumeBase, 0),
    volumeQuote: bucket.reduce((sum, candle) => sum + candle.volumeQuote, 0),
    tradeCount: bucket.reduce((sum, candle) => sum + candle.tradeCount, 0),
    source: buildAggregatedSource(first, last),
    qualityFlags: {
      ...(hasNoTradeInterval ? { noTradeInterval: true } : {}),
      ...(hasFillForwarded ? { fillForwarded: true } : {}),
      ...(bucket.some((candle) => candle.qualityFlags.extremeWick)
        ? { extremeWick: true }
        : {}),
      ...(bucket.some((candle) => candle.qualityFlags.incompleteBlockRange)
        ? { incompleteBlockRange: true }
        : {}),
      ...(bucket.some((candle) => candle.qualityFlags.reorgAdjusted)
        ? { reorgAdjusted: true }
        : {}),
      ...(bucket.some((candle) => candle.qualityFlags.lowTradeCount)
        ? { lowTradeCount: true }
        : {}),
      ...(bucket.some((candle) => candle.qualityFlags.multiAmmTransaction)
        ? { multiAmmTransaction: true }
        : {}),
      ...(bucket.some((candle) => candle.qualityFlags.multiHopSuspected)
        ? { multiHopSuspected: true }
        : {}),
      ...(bucket.some((candle) => candle.qualityFlags.sameMintExtraTransfers)
        ? { sameMintExtraTransfers: true }
        : {}),
      ...(bucket.some((candle) => candle.qualityFlags.nativeSolRentAmbiguity)
        ? { nativeSolRentAmbiguity: true }
        : {}),
      ...(bucket.some((candle) => candle.qualityFlags.poolVaultsNotVerified)
        ? { poolVaultsNotVerified: true }
        : {}),
      ...(bucket.some((candle) => candle.qualityFlags.orderingApproximate)
        ? { orderingApproximate: true }
        : {}),
    },
  };
}

function buildAggregatedSource(
  first: DexPoolCandle,
  last: DexPoolCandle,
): DexPoolCandle["source"] {
  const txRefRange = [
    first.source.txRefRange?.[0] ?? "",
    last.source.txRefRange?.at(-1) ?? "",
  ].filter((value) => value.length > 0);

  return {
    mode: first.source.mode,
    ...(first.source.fromOrderingKey !== undefined
      ? { fromOrderingKey: first.source.fromOrderingKey }
      : {}),
    ...(last.source.toOrderingKey !== undefined
      ? { toOrderingKey: last.source.toOrderingKey }
      : {}),
    ...(txRefRange.length > 0 ? { txRefRange } : {}),
  };
}
