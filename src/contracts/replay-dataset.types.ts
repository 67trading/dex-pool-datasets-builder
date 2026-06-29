import type { Timeframe } from "./timeframe.js";

export type DatasetSource = "DEX_POOL";
export type DatasetVersion = "dex-pool-replay-v1";

export type HistoricalKline = {
  symbol: string;
  timeframe: Timeframe;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  closed: true;
  source: DatasetSource;
  quoteVolume?: number;
  trades?: number;
};

export type ImportPeriod = {
  from: string;
  to: string;
};

export type DatasetManifest = {
  schemaVersion: 2;
  datasetType: "DEX_POOL";
  replayFormat: "HISTORICAL_KLINE_COMPATIBLE";
  datasetId: string;
  source: DatasetSource;
  datasetVersion: DatasetVersion;
  period: ImportPeriod;
  startTime: string;
  endTime: string;
  symbols: string[];
  replaySymbols: string[];
  timeframes: Record<string, Timeframe[]>;
  contextSymbols: Record<string, never>;
  tradableSymbols: Record<
    string,
    {
      role: "TRADABLE";
      timeframes: Timeframe[];
      relativeStrengthMode: "SELF_BENCHMARK";
    }
  >;
  timezone: "UTC";
  timestampConvention: "UTC_EPOCH_MS_OPEN_TIME_WITH_INCLUSIVE_CLOSE_TIME";
  createdAt: string;
  generatedAt: string;
  checksum: string;
  sourceDetails: {
    provider: "dex_pool";
    endpoint: string;
    timezone: "UTC";
  };
  sourceDataset: {
    datasetId: string;
    sourceMode: "ONCHAIN_POOL_EVENTS";
    chain: string;
    dex: string;
    poolAddress: string;
  };
  adapterPolicy: {
    symbolPolicy: "BASE_QUOTE_SYMBOL";
    noTradeIntervalPolicy: "FILL_FORWARD_ZERO_VOLUME";
    availableFromPolicy: "CANDLE_CLOSE_TIME";
    preserveDexMetadataInSidecar: true;
  };
};
