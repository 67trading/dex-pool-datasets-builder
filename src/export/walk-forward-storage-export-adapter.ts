import { createHash } from "node:crypto";
import type { Timeframe } from "../contracts/timeframe.js";
import { getTimeframeMs } from "../contracts/timeframe.js";
import type { DatasetManifest } from "../contracts/replay-dataset.types.js";
import type {
  DatasetStorage,
  WrittenDatasetObject,
} from "../storage/dataset-storage.types.js";
import type {
  DexPoolCandle,
  DexPoolDatasetManifest,
  DexPoolReplayQualityRecord,
} from "../types/dex-pool-dataset.types.js";
import { toHistoricalKline } from "./walk-forward-export-adapter.js";

export type ExportDexWalkForwardToStorageOptions = {
  truthManifest: DexPoolDatasetManifest;
  candlesByTimeframe: Partial<Record<Timeframe, DexPoolCandle[]>>;
  storage: DatasetStorage;
  rootKey: string;
  now?: Date;
};

export type ExportDexWalkForwardToStorageResult = {
  manifest: DatasetManifest;
  qualityRecords: DexPoolReplayQualityRecord[];
  writtenObjects: WrittenDatasetObject[];
};

export async function exportDexWalkForwardDatasetToStorage(
  options: ExportDexWalkForwardToStorageOptions,
): Promise<ExportDexWalkForwardToStorageResult> {
  const { truthManifest, candlesByTimeframe, storage, rootKey } = options;
  const writtenObjects: WrittenDatasetObject[] = [];
  const qualityRecords: DexPoolReplayQualityRecord[] = [];
  const timeframesBySymbol: Record<string, Timeframe[]> = {};
  const replaySymbols = new Set<string>();
  let firstOpenTime = Number.POSITIVE_INFINITY;
  let lastCloseTime = Number.NEGATIVE_INFINITY;

  // Track key -> body for checksum computation (same logic as existing adapter)
  const checksumEntries: Array<{ key: string; body: Buffer }> = [];

  for (const timeframe of truthManifest.timeframes) {
    const candles = candlesByTimeframe[timeframe] ?? [];
    if (candles.length === 0) {
      throw new Error(`DEX_REPLAY_TIMEFRAME_EMPTY:${timeframe}`);
    }
    validateReplayContinuity(candles, timeframe);

    const symbol = candles[0]!.symbol;
    validateSingleReplaySymbol(candles, timeframe, symbol);
    replaySymbols.add(symbol);
    const existing = timeframesBySymbol[symbol] ?? [];
    timeframesBySymbol[symbol] = [...existing, timeframe];
    firstOpenTime = Math.min(firstOpenTime, candles[0]!.openTime);
    lastCloseTime = Math.max(lastCloseTime, candles.at(-1)!.closeTime);

    const rows = candles.map(toHistoricalKline);
    const jsonlBody = buildJsonlBody(rows);
    const key = `${rootKey}/${symbol}/${timeframe}.jsonl`;
    const written = await storage.writeObject({
      key,
      body: jsonlBody,
      contentType: "application/x-ndjson",
    });
    writtenObjects.push(written);
    checksumEntries.push({ key, body: Buffer.from(jsonlBody, "utf8") });

    for (const candle of candles) {
      if (Object.keys(candle.qualityFlags).length === 0) continue;
      qualityRecords.push({
        symbol: candle.symbol,
        timeframe,
        openTime: candle.openTime,
        qualityFlags: candle.qualityFlags,
        source: {
          ...candle.source,
          poolAddress: candle.poolAddress,
        },
      });
    }
  }

  const qualityKey = `${rootKey}/dex-quality.jsonl`;
  const qualityBody = buildJsonlBody(qualityRecords);
  const writtenQuality = await storage.writeObject({
    key: qualityKey,
    body: qualityBody,
    contentType: "application/x-ndjson",
  });
  writtenObjects.push(writtenQuality);
  checksumEntries.push({
    key: qualityKey,
    body: Buffer.from(qualityBody, "utf8"),
  });

  const generatedAt = (options.now ?? new Date()).toISOString();
  const checksum = checksumFromEntries(checksumEntries, rootKey);
  const symbols = Array.from(replaySymbols).sort();
  assertTimeRangeMatchesCandles(truthManifest, firstOpenTime, lastCloseTime);

  const manifest: DatasetManifest = {
    schemaVersion: 2,
    datasetType: "DEX_POOL",
    replayFormat: "HISTORICAL_KLINE_COMPATIBLE",
    datasetId: truthManifest.datasetId,
    source: "DEX_POOL",
    datasetVersion: "dex-pool-replay-v1",
    period: truthManifest.timeRange,
    startTime: new Date(firstOpenTime).toISOString(),
    endTime: new Date(lastCloseTime).toISOString(),
    symbols,
    replaySymbols: symbols,
    timeframes: timeframesBySymbol,
    contextSymbols: {},
    tradableSymbols: Object.fromEntries(
      symbols.map((symbol) => [
        symbol,
        {
          role: "TRADABLE",
          timeframes: timeframesBySymbol[symbol] ?? [],
          relativeStrengthMode: "SELF_BENCHMARK",
        },
      ]),
    ),
    timezone: "UTC",
    timestampConvention: "UTC_EPOCH_MS_OPEN_TIME_WITH_INCLUSIVE_CLOSE_TIME",
    createdAt: generatedAt,
    generatedAt,
    checksum,
    sourceDetails: {
      provider: "dex_pool",
      endpoint: truthManifest.source.eventSource,
      timezone: "UTC",
    },
    sourceDataset: {
      datasetId: truthManifest.datasetId,
      sourceMode: "ONCHAIN_POOL_EVENTS",
      chain: truthManifest.chain,
      dex: truthManifest.dex,
      poolAddress: truthManifest.poolAddress,
    },
    adapterPolicy: {
      symbolPolicy: "BASE_QUOTE_SYMBOL",
      noTradeIntervalPolicy: "FILL_FORWARD_ZERO_VOLUME",
      availableFromPolicy: "CANDLE_CLOSE_TIME",
      preserveDexMetadataInSidecar: true,
    },
  };

  const manifestKey = `${rootKey}/manifest.json`;
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  const writtenManifest = await storage.writeObject({
    key: manifestKey,
    body: manifestBody,
    contentType: "application/json",
  });
  writtenObjects.push(writtenManifest);

  return { manifest, qualityRecords, writtenObjects };
}

function buildJsonlBody(rows: unknown[]): string {
  return (
    rows.map((row) => JSON.stringify(row)).join("\n") +
    (rows.length > 0 ? "\n" : "")
  );
}

function checksumFromEntries(
  entries: Array<{ key: string; body: Buffer }>,
  rootKey: string,
): string {
  const hash = createHash("sha256");
  // Sort by relative key, matching the existing adapter's path.sort() behavior
  const sorted = [...entries].sort((a, b) => {
    const relA = relativeKey(a.key, rootKey);
    const relB = relativeKey(b.key, rootKey);
    return relA < relB ? -1 : relA > relB ? 1 : 0;
  });
  for (const entry of sorted) {
    hash.update(relativeKey(entry.key, rootKey));
    hash.update("\0");
    hash.update(entry.body);
    hash.update("\n");
  }
  return hash.digest("hex");
}

function relativeKey(key: string, rootKey: string): string {
  const prefix = rootKey.endsWith("/") ? rootKey : `${rootKey}/`;
  if (key.startsWith(prefix)) {
    return key.slice(prefix.length);
  }
  return key;
}

function validateReplayContinuity(
  candles: DexPoolCandle[],
  timeframe: Timeframe,
): void {
  const intervalMs = getTimeframeMs(timeframe);

  let previousOpenTime = Number.NEGATIVE_INFINITY;
  for (const candle of candles) {
    assertFiniteCandleNumbers(candle, timeframe);
    if (candle.timeframe !== timeframe) {
      throw new Error(
        `DEX_REPLAY_TIMEFRAME_MISMATCH:${candle.symbol}:${timeframe}:${candle.timeframe}`,
      );
    }
    if (candle.closeTime !== candle.openTime + intervalMs - 1) {
      throw new Error(
        `DEX_REPLAY_INVALID_INTERVAL:${candle.symbol}:${timeframe}:${candle.openTime}:${candle.closeTime}`,
      );
    }
    if (candle.openTime % intervalMs !== 0) {
      throw new Error(
        `DEX_REPLAY_TIME_MISALIGNED:${candle.symbol}:${timeframe}:${candle.openTime}`,
      );
    }
    if (candle.openTime <= previousOpenTime) {
      throw new Error(
        `DEX_REPLAY_UNSORTED:${candle.symbol}:${timeframe}:${candle.openTime}`,
      );
    }
    if (
      Number.isFinite(previousOpenTime) &&
      candle.openTime - previousOpenTime !== intervalMs
    ) {
      throw new Error(
        `DEX_REPLAY_GAP:${candle.symbol}:${timeframe}:${previousOpenTime}:${candle.openTime}`,
      );
    }
    if (
      candle.open <= 0 ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.high < candle.low ||
      candle.low <= 0
    ) {
      throw new Error(
        `DEX_REPLAY_INVALID_OHLC:${candle.symbol}:${timeframe}:${candle.openTime}`,
      );
    }
    if (
      candle.volumeBase < 0 ||
      candle.volumeQuote < 0 ||
      candle.tradeCount < 0
    ) {
      throw new Error(
        `DEX_REPLAY_INVALID_VOLUME:${candle.symbol}:${timeframe}:${candle.openTime}`,
      );
    }
    previousOpenTime = candle.openTime;
  }
}

function assertFiniteCandleNumbers(
  candle: DexPoolCandle,
  timeframe: Timeframe,
): void {
  const values = [
    candle.openTime,
    candle.closeTime,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volumeBase,
    candle.volumeQuote,
    candle.tradeCount,
  ];
  if (!values.every(Number.isFinite)) {
    throw new Error(
      `DEX_REPLAY_INVALID_NUMBER:${candle.symbol}:${timeframe}:${candle.openTime}`,
    );
  }
}

function validateSingleReplaySymbol(
  candles: DexPoolCandle[],
  timeframe: Timeframe,
  expectedSymbol: string,
): void {
  for (const candle of candles) {
    if (candle.symbol !== expectedSymbol) {
      throw new Error(
        `DEX_REPLAY_MIXED_SYMBOLS:${timeframe}:${expectedSymbol}:${candle.symbol}:${candle.openTime}`,
      );
    }
  }
}

function assertTimeRangeMatchesCandles(
  manifest: DexPoolDatasetManifest,
  firstOpenTime: number,
  lastCloseTime: number,
): void {
  const manifestFrom = Date.parse(manifest.timeRange.from);
  const manifestTo = Date.parse(manifest.timeRange.to);
  if (!Number.isFinite(manifestFrom) || !Number.isFinite(manifestTo)) {
    throw new Error("DEX_REPLAY_MANIFEST_TIME_RANGE_INVALID");
  }
  if (manifestFrom !== firstOpenTime) {
    throw new Error(
      `DEX_REPLAY_PERIOD_FROM_MISMATCH:${manifestFrom}:${firstOpenTime}`,
    );
  }
  if (manifestTo !== lastCloseTime) {
    throw new Error(
      `DEX_REPLAY_PERIOD_TO_MISMATCH:${manifestTo}:${lastCloseTime}`,
    );
  }
}
