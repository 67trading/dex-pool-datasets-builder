import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Timeframe } from "../contracts/timeframe.js";
import { getTimeframeMs } from "../contracts/timeframe.js";
import type {
  DatasetManifest,
  HistoricalKline,
} from "../contracts/replay-dataset.types.js";
import type {
  DexPoolCandle,
  DexPoolDatasetManifest,
  DexPoolReplayQualityRecord,
} from "../types/dex-pool-dataset.types.js";

export type ExportDexWalkForwardOptions = {
  truthManifest: DexPoolDatasetManifest;
  candlesByTimeframe: Partial<Record<Timeframe, DexPoolCandle[]>>;
  outputDir: string;
  now?: Date;
};

export type ExportDexWalkForwardResult = {
  manifest: DatasetManifest;
  qualityRecords: DexPoolReplayQualityRecord[];
  writtenFiles: string[];
};

export async function exportDexWalkForwardDataset(
  options: ExportDexWalkForwardOptions,
): Promise<ExportDexWalkForwardResult> {
  const outputDir = resolve(options.outputDir);
  const writtenFiles: string[] = [];
  const qualityRecords: DexPoolReplayQualityRecord[] = [];
  const timeframesBySymbol: Record<string, Timeframe[]> = {};
  const replaySymbols = new Set<string>();
  let firstOpenTime = Number.POSITIVE_INFINITY;
  let lastCloseTime = Number.NEGATIVE_INFINITY;

  for (const timeframe of options.truthManifest.timeframes) {
    const candles = options.candlesByTimeframe[timeframe] ?? [];
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
    const filePath = join(outputDir, symbol, `${timeframe}.jsonl`);
    await writeJsonl(filePath, rows);
    writtenFiles.push(filePath);

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

  const qualityPath = join(outputDir, "dex-quality.jsonl");
  await writeJsonl(qualityPath, qualityRecords);
  writtenFiles.push(qualityPath);

  const generatedAt = (options.now ?? new Date()).toISOString();
  const checksum = await checksumFiles(writtenFiles, outputDir);
  const symbols = Array.from(replaySymbols).sort();
  assertTimeRangeMatchesCandles(
    options.truthManifest,
    firstOpenTime,
    lastCloseTime,
  );
  const manifest: DatasetManifest = {
    schemaVersion: 2,
    datasetType: "DEX_POOL",
    replayFormat: "HISTORICAL_KLINE_COMPATIBLE",
    datasetId: options.truthManifest.datasetId,
    source: "DEX_POOL",
    datasetVersion: "dex-pool-replay-v1",
    period: options.truthManifest.timeRange,
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
      endpoint: options.truthManifest.source.eventSource,
      timezone: "UTC",
    },
    sourceDataset: {
      datasetId: options.truthManifest.datasetId,
      sourceMode: "ONCHAIN_POOL_EVENTS",
      chain: options.truthManifest.chain,
      dex: options.truthManifest.dex,
      poolAddress: options.truthManifest.poolAddress,
    },
    adapterPolicy: {
      symbolPolicy: "BASE_QUOTE_SYMBOL",
      noTradeIntervalPolicy: "FILL_FORWARD_ZERO_VOLUME",
      availableFromPolicy: "CANDLE_CLOSE_TIME",
      preserveDexMetadataInSidecar: true,
    },
  };

  await writeJson(join(outputDir, "manifest.json"), manifest);
  return {
    manifest,
    qualityRecords,
    writtenFiles: [...writtenFiles, join(outputDir, "manifest.json")],
  };
}

export function toHistoricalKline(candle: DexPoolCandle): HistoricalKline {
  return {
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    openTime: candle.openTime,
    closeTime: candle.closeTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volumeBase,
    turnover: candle.volumeQuote,
    quoteVolume: candle.volumeQuote,
    trades: candle.tradeCount,
    closed: true,
    source: "DEX_POOL",
  };
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

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(
    path,
    rows.map((row) => JSON.stringify(row)).join("\n") +
      (rows.length > 0 ? "\n" : ""),
    "utf8",
  );
}

async function checksumFiles(
  paths: string[],
  rootDir: string,
): Promise<string> {
  const hash = createHash("sha256");
  for (const path of paths.sort()) {
    hash.update(relative(rootDir, path));
    hash.update("\0");
    const content = await readFile(path);
    hash.update(content);
    hash.update("\n");
  }
  return hash.digest("hex");
}
