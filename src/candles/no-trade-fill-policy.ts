import type { Timeframe } from "../contracts/timeframe.js";
import { getTimeframeMs } from "../contracts/timeframe.js";
import type { DexPoolCandle } from "../types/dex-pool-dataset.types.js";

export type FillNoTradeIntervalsOptions = {
  candles: DexPoolCandle[];
  timeframe: Timeframe;
  fromTime: number;
  toTime: number;
};

export function fillNoTradeIntervals(
  options: FillNoTradeIntervalsOptions,
): DexPoolCandle[] {
  const intervalMs = getTimeframeMs(options.timeframe);
  const alignedFrom = alignOpenTime(options.fromTime, intervalMs);
  const alignedTo = alignOpenTime(options.toTime, intervalMs);
  const byOpenTime = new Map(
    options.candles.map((candle) => [candle.openTime, candle]),
  );
  const filled: DexPoolCandle[] = [];
  let previous: DexPoolCandle | undefined;
  const firstCandle = [...options.candles].sort(
    (a, b) => a.openTime - b.openTime,
  )[0];
  if (firstCandle === undefined && alignedFrom <= alignedTo) {
    throw new Error(`DEX_FILL_EMPTY_SOURCE_RANGE:${alignedFrom}:${alignedTo}`);
  }
  if (firstCandle !== undefined && firstCandle.openTime > alignedFrom) {
    throw new Error(
      `DEX_FILL_LEADING_INTERVAL_WITHOUT_PRIOR_CANDLE:${alignedFrom}:${firstCandle.openTime}`,
    );
  }

  for (
    let openTime = alignedFrom;
    openTime <= alignedTo;
    openTime += intervalMs
  ) {
    const existing = byOpenTime.get(openTime);
    if (existing !== undefined) {
      filled.push(existing);
      previous = existing;
      continue;
    }
    if (previous === undefined) {
      continue;
    }
    const fill = buildFillForwardCandle(previous, openTime, intervalMs);
    filled.push(fill);
    previous = fill;
  }

  return filled;
}

function buildFillForwardCandle(
  previous: DexPoolCandle,
  openTime: number,
  intervalMs: number,
): DexPoolCandle {
  return {
    ...previous,
    openTime,
    closeTime: openTime + intervalMs - 1,
    open: previous.close,
    high: previous.close,
    low: previous.close,
    close: previous.close,
    volumeBase: 0,
    volumeQuote: 0,
    tradeCount: 0,
    source: buildFillSource(previous),
    qualityFlags: {
      noTradeInterval: true,
      fillForwarded: true,
    },
  };
}

function buildFillSource(previous: DexPoolCandle): DexPoolCandle["source"] {
  return {
    mode: previous.source.mode,
    ...(previous.source.toOrderingKey !== undefined
      ? {
          fromOrderingKey: previous.source.toOrderingKey,
          toOrderingKey: previous.source.toOrderingKey,
        }
      : {}),
    ...(previous.source.txRefRange !== undefined
      ? { txRefRange: previous.source.txRefRange }
      : {}),
  };
}

function alignOpenTime(value: number, intervalMs: number): number {
  return Math.floor(value / intervalMs) * intervalMs;
}
