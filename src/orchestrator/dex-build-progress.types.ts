export type DexBuildProgressEvent =
  | {
      type: "build_start";
      datasetId: string;
    }
  | {
      type: "pool_start";
      poolId: string;
      poolAddress: string;
    }
  | {
      type: "logs_read_start";
      poolId: string;
      chunks: number;
      fromBlock: string;
      toBlock: string;
    }
  | {
      type: "logs_chunk_start";
      poolId: string;
      index: number;
      total: number;
      fromBlock: string;
      toBlock: string;
    }
  | {
      type: "logs_chunk_done";
      poolId: string;
      index: number;
      total: number;
      logCount: number;
    }
  | {
      type: "timestamps_progress";
      poolId: string;
      done: number;
      total: number;
      cacheHits: number;
      cacheMisses: number;
    }
  | {
      type: "swaps_decoded";
      poolId: string;
      swaps: number;
    }
  | {
      type: "candles_build_start";
      poolId: string;
      timeframe: string;
    }
  | {
      type: "candles_fill_done";
      poolId: string;
      filledNoTradeIntervals: number;
    }
  | {
      type: "timeframe_aggregate_done";
      poolId: string;
      timeframe: string;
      candles: number;
    }
  | {
      type: "write_start";
      poolId: string;
    }
  | {
      type: "write_done";
      poolId: string;
      objects: number;
    }
  | {
      type: "build_done";
      datasetId: string;
      status: "completed" | "failed";
    };

export type DexBuildProgressHandler = (event: DexBuildProgressEvent) => void;
