import type { Timeframe } from "../contracts/timeframe.js";
import type { DexPoolSelectionMetadata } from "../simple/pool-selection-metadata.types.js";

export type DexChain = "ethereum" | "base" | "arbitrum" | "polygon" | "bsc";
export type DexPoolKind = "UNISWAP_V3_STYLE" | "UNISWAP_V2_STYLE";
export type DexTokenRef = "token0" | "token1";

export type DexPoolToken = {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
};

export type DexPoolConfig = {
  id: string;
  chain: DexChain;
  dex: string;
  kind: DexPoolKind;
  poolAddress: `0x${string}`;
  token0: DexPoolToken;
  token1: DexPoolToken;
  baseToken: DexTokenRef;
  quoteToken: DexTokenRef;
  feeTier?: number;
  startBlock: string;
  endBlock?: string;
};

export type NormalizedPoolSwap = {
  chain: DexChain;
  dex: string;
  poolAddress: `0x${string}`;
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  blockTimestamp: number;
  token0Symbol: string;
  token1Symbol: string;
  amount0: number;
  amount1: number;
  amount0Raw?: string;
  amount1Raw?: string;
  priceToken1PerToken0: number;
  priceToken0PerToken1: number;
  sqrtPriceX96Raw?: string;
  liquidityAfter?: string;
  tickAfter?: number;
  raw?: unknown;
};

export type DexPoolCandleQualityFlags = {
  noTradeInterval?: boolean;
  fillForwarded?: boolean;
  incompleteBlockRange?: boolean;
  reorgAdjusted?: boolean;
  extremeWick?: boolean;
  lowTradeCount?: boolean;
};

export type DexPoolCandleSource = {
  mode: "ONCHAIN_POOL_EVENTS";
  fromBlock?: string;
  toBlock?: string;
  blockHashRange?: string[];
  rawSwapRange?: {
    first: DexPoolSwapRawAudit;
    last: DexPoolSwapRawAudit;
  };
};

export type DexPoolSwapRawAudit = {
  transactionHash: string;
  logIndex: number;
  amount0Raw?: string;
  amount1Raw?: string;
  sqrtPriceX96Raw?: string;
};

export type DexPoolCandle = {
  venueType: "DEX_POOL";
  chain: DexChain;
  dex: string;
  poolAddress: `0x${string}`;
  baseSymbol: string;
  quoteSymbol: string;
  symbol: string;
  timeframe: Timeframe;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeBase: number;
  volumeQuote: number;
  tradeCount: number;
  source: DexPoolCandleSource;
  qualityFlags: DexPoolCandleQualityFlags;
};

export type DexPoolQualitySummary = {
  passed: boolean;
  duplicateLogs: number;
  invalidLogs: number;
  missingBlockTimestamps: number;
  reorgConflicts: number;
  noTradeIntervals: number;
  extremeWickCandles: number;
  incompleteBlockRanges: number;
};

export type DexPoolDatasetManifest = {
  datasetType: "DEX_POOL";
  sourceMode: "ONCHAIN_POOL_EVENTS";
  datasetId: string;

  chain: DexChain;
  dex: string;
  poolKind: DexPoolKind;
  poolAddress: `0x${string}`;

  poolSelection?: DexPoolSelectionMetadata;

  token0: DexPoolToken;
  token1: DexPoolToken;
  baseToken: DexTokenRef;
  quoteToken: DexTokenRef;

  blockRange: {
    fromBlock: string;
    toBlock: string;
    finalizedToBlock: string;
    finalityMode: "finalized" | "safe" | "confirmation_lag";
    confirmations?: number;
    requestedToBlock?: string;
    clippedToFinality?: boolean;
  };

  timeRange: {
    from: string;
    to: string;
  };

  source: {
    rpcProvider: "configured_archive_rpc";
    eventSource: "eth_getLogs";
    events: string[];
  };

  timeframes: Timeframe[];

  replaySafety: {
    closedCandlesOnly: true;
    availableFromCloseTime: true;
    lookaheadSafe: true;
    intrablockOrderingPreserved: true;
  };

  quality: DexPoolQualitySummary;
  generatedAt: string;
};

export type DexPoolReplayQualityRecord = {
  symbol: string;
  timeframe: Timeframe;
  openTime: number;
  qualityFlags: DexPoolCandleQualityFlags;
  source: DexPoolCandleSource & {
    poolAddress: `0x${string}`;
  };
};
