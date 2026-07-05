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

  /**
   * How amount0/amount1 were derived.
   *
   * EXACT_LOG_DECODE: read directly off a protocol event (EVM Swap log) —
   * exact by construction.
   * TX_GROSS_TOKEN_BALANCE_DIFF: derived from a transaction-wide
   * pre/post token balance diff (Solana) — see solana-token-balance-diff.ts.
   * This is NOT guaranteed to isolate a single pool's contribution when
   * the same transaction routes through more than one AMM (see
   * qualityFlags.multiAmmTransaction/multiHopSuspected on affected swaps).
   */
  attributionMode?: "EXACT_LOG_DECODE" | "TX_GROSS_TOKEN_BALANCE_DIFF";

  /** Self-contained decimals so a raw amount string is interpretable without the pool config. */
  token0Decimals?: number;
  token1Decimals?: number;

  /** Per-swap caveats, rolled up into the containing candle's qualityFlags. */
  qualityFlags?: DexPoolCandleQualityFlags;

  raw?: unknown;
};

export type DexPoolCandleQualityFlags = {
  noTradeInterval?: boolean;
  fillForwarded?: boolean;
  incompleteBlockRange?: boolean;
  reorgAdjusted?: boolean;
  extremeWick?: boolean;
  lowTradeCount?: boolean;

  /**
   * Solana token-balance-diff attribution caveats (see
   * solana-pool-swap-reader.ts). Never set on EVM log-decoded swaps.
   */
  /** Another recognized AMM program was invoked in the same transaction. */
  multiAmmTransaction?: boolean;
  /** A non-infrastructure program beyond this pool's own ran in the same transaction — a hop-like signal, recognized or not. */
  multiHopSuspected?: boolean;
  /** The gross positive/negative token deltas for a mint didn't balance — a transient (create+close) account or an unrelated transfer of the same mint is likely present. */
  sameMintExtraTransfers?: boolean;
  /** One of the pool's mints is native/wrapped SOL, where ATA rent create/close noise can distort the balance diff. */
  nativeSolRentAmbiguity?: boolean;
  /** The technique never verifies which accounts are the pool's own vaults — always true for TX_GROSS_TOKEN_BALANCE_DIFF swaps. */
  poolVaultsNotVerified?: boolean;
  /** No reliable in-slot transaction index was available; ordering falls back to a deterministic-but-not-necessarily-chronological signature tiebreaker. */
  orderingApproximate?: boolean;
};

export type DexPoolCandleSource = {
  mode: "ONCHAIN_POOL_EVENTS" | "ONCHAIN_TX_TOKEN_BALANCE_DIFF";
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
  token0Decimals?: number;
  token1Decimals?: number;
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

export type SolanaBackfillStopReason =
  | "REACHED_FROM_SLOT"
  | "MAX_SIGNATURES_COLLECTED"
  | "MAX_SCANNED_PAGES"
  | "RPC_LIMIT"
  | "EMPTY_PAGE";

/**
 * Honesty about how much of the requested range was actually scanned.
 *
 * getSignaturesForAddress pages newest-first with before/until signature
 * cursors, not a slot-range RPC filter — for a high-volume address and an
 * old requested range, the scan can exhaust its page/signature budget
 * before ever reaching fromSlot. rangeComplete=false means the dataset is
 * NOT a guaranteed-full backfill of the requested range.
 */
export type BackfillCompleteness = {
  requestedFromSlot: string;
  requestedToSlot: string;
  scannedSignatureCount: number;
  collectedSignatureCount: number;
  rangeComplete: boolean;
  stopReason: SolanaBackfillStopReason;
};

export type DexPoolDatasetManifest = {
  datasetType: "DEX_POOL";
  sourceMode: "ONCHAIN_POOL_EVENTS" | "ONCHAIN_TX_TOKEN_BALANCE_DIFF";
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

    /**
     * False whenever any swap in this dataset fell back to an
     * approximate (non-chronological-within-slot) ordering tiebreaker —
     * see DexPoolCandleQualityFlags.orderingApproximate. Always true for
     * EVM (block/txIndex/logIndex ordering is exact).
     */
    intrablockOrderingPreserved: boolean;

    /**
     * False for TX_GROSS_TOKEN_BALANCE_DIFF-attributed pools (current
     * Solana adapters) — volumes can include other legs of a multi-hop
     * route or unrelated same-mint transfers. True for EVM.
     */
    poolVolumeExact: boolean;
  };

  /** Populated for Solana pools; omitted for EVM, whose eth_getLogs range read is exhaustive by construction. */
  backfillCompleteness?: BackfillCompleteness;

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
