import type { Timeframe } from "../contracts/timeframe.js";
import type { DexPoolQualitySummary } from "../types/dex-pool-dataset.types.js";
import type { WrittenDatasetObject } from "../storage/dataset-storage.types.js";

export type DexBuildRunReport = {
  schemaVersion: 1;
  datasetId: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "failed";
  config: {
    profile?: string;
    registryPath: string;
    outputUri: string;
    selectedPools: string[];
  };
  pools: Array<{
    poolId: string;
    symbol: string;
    blockRange: {
      fromBlock: string;
      toBlock: string;
    };
    timeframes: Timeframe[];
    quality: DexPoolQualitySummary;
    writtenObjects: WrittenDatasetObject[];
  }>;
  fatalErrors: Array<{
    code: string;
    message: string;
    poolId?: string;
  }>;
};

export type DexBuildResult = {
  runReport: DexBuildRunReport;
  status: "completed" | "failed";
};
