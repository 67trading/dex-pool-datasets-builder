import type { Timeframe } from "../contracts/timeframe.js";
import type { DexPoolSelectionMetadata } from "../simple/pool-selection-metadata.types.js";

export type DexChain =
  | "ethereum"
  | "base"
  | "arbitrum"
  | "polygon"
  | "bsc"
  | "solana";
export type DexPoolKind =
  | "UNISWAP_V3_STYLE"
  | "UNISWAP_V2_STYLE"
  | "SOLANA_AMM_STYLE";
export type DexTokenRef = "token0" | "token1";

/**
 * Chain-native address string.
 *
 * EVM: `0x${40 hex chars}`. Solana: base58-encoded 32-byte pubkey.
 * Kept as plain `string` at this shared boundary so both families can
 * flow through one contract; chain-specific layers validate the exact
 * format (see evm-address.ts / solana-address.ts).
 */
export type DexPoolAddress = string;

export type DexPoolToken = {
  symbol: string;
  address: DexPoolAddress;
  decimals: number;
};

export type DexPoolConfig = {
  id: string;
  chain: DexChain;
  dex: string;
  kind: DexPoolKind;
  poolAddress: DexPoolAddress;
  token0: DexPoolToken;
  token1: DexPoolToken;
  baseToken: DexTokenRef;
  quoteToken: DexTokenRef;
  feeTier?: number;

  /**
   * Chain-native starting cursor as a decimal string.
   *
   * EVM: block number. Solana: slot number.
   */
  startBlock: string;
  endBlock?: string;

  /**
   * Solana-only: the AMM program id that owns this pool account.
   * Required for SOLANA_AMM_STYLE pools; unused for EVM pools.
   */
  programId?: string;
};

/**
 * A single swap event, normalized across chain families.
 *
 * The shared candle pipeline (pool-candle-builder / timeframe-aggregator /
 * no-trade-fill-policy) only ever touches the fields below — it has no
 * knowledge of blocks, slots, logs or instructions. Chain-specific adapters
 * (src/evm/*, src/solana/*) are responsible for producing a correctly
 * ordered, deduplicated stream of these records.
 */
export type NormalizedPoolSwap = {
  chain: DexChain;
  dex: string;
  poolAddress: DexPoolAddress;

  /**
   * Monotonically sortable, globally-unique-per-pool composite key.
   *
   * Lexicographic string ordering must equal chronological ordering.
   * EVM: zero-padded `blockNumber:transactionIndex:logIndex`.
   * Solana: zero-padded `slot:transactionIndex:instructionRefIndex`.
   */
  orderingKey: string;

  /**
   * Human-auditable reference to the underlying on-chain event.
   *
   * EVM: transaction hash. Solana: transaction signature.
   * Not guaranteed unique on its own (one tx can contain multiple swaps).
   */
  txRef: string;

  blockTimestamp: number;
  token0Symbol: string;
  token1Symbol: string;
  amount0: number;
  amount1: number;
  amount0Raw?: string;
  amount1Raw?: string;
  priceToken1PerToken0: number;
  priceToken0PerToken1: number;

  /**
   * Uniswap-v3-style extras. Optional and unused by the shared pipeline;
   * carried through only for EVM audit/debug purposes.
   */
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
  fromOrderingKey?: string;
  toOrderingKey?: string;
  txRefRange?: string[];
  rawSwapRange?: {
    first: DexPoolSwapRawAudit;
    last: DexPoolSwapRawAudit;
  };
};

export type DexPoolSwapRawAudit = {
  txRef: string;
  orderingKey: string;
  amount0Raw?: string;
  amount1Raw?: string;
  sqrtPriceX96Raw?: string;
};

export type DexPoolCandle = {
  venueType: "DEX_POOL";
  chain: DexChain;
  dex: string;
  poolAddress: DexPoolAddress;
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
  poolAddress: DexPoolAddress;

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
    eventSource: "eth_getLogs" | "solana_transaction_token_balance_diff";
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
    poolAddress: DexPoolAddress;
  };
};
