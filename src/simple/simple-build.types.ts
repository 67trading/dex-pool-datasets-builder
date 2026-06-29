import type { Timeframe } from "../contracts/timeframe.js";

export type SimplePoolSelectionInput = {
  /**
   * Direct pool contract address.
   */
  pool?: `0x${string}` | string;

  /**
   * Pair selector.
   *
   * Example:
   * WETH/USDC
   */
  pair?: string;

  /**
   * Uniswap v3 fee tier.
   *
   * Examples:
   * 100, 500, 3000, 10000
   */
  fee?: number | string;

  /**
   * Token address selectors for factory.getPool(token0, token1, fee).
   */
  token0?: string;
  token1?: string;

  /**
   * Optional base/quote selectors.
   * Can be token symbol or address.
   */
  base?: string;
  quote?: string;
};

export type SimplePairSelectionInput =
  | string
  | {
      pair: string;
      fee?: number | string;
      base?: string;
      quote?: string;
    };

export type SimpleDexBuildInput = {
  chain: string;

  /**
   * Single-selection mode.
   *
   * Kept for backwards compatibility and simple one-off CLI usage.
   */
  pool?: `0x${string}` | string;
  pair?: string;
  fee?: number | string;
  token0?: string;
  token1?: string;
  base?: string;
  quote?: string;

  /**
   * Multi-selection mode.
   */
  pools?: Array<`0x${string}` | string>;
  pairs?: SimplePairSelectionInput[];
  symbols?: SimplePoolSelectionInput[];

  /**
   * Start date/time.
   *
   * Accepted examples:
   * - 2024-01-01
   * - 2024-01-01T00:00:00Z
   */
  from: string;

  /**
   * Exclusive end date/time.
   *
   * Either `to` or `days` is required.
   */
  to?: string;

  /**
   * Duration in days when `to` is omitted.
   */
  days?: number;

  /**
   * Direct RPC URL.
   * If omitted, `rpcUrlEnv` or the chain preset env var is used.
   */
  rpcUrl?: string;

  /**
   * RPC environment variable name.
   *
   * Example:
   * BASE_RPC_URL
   */
  rpcUrlEnv?: string;

  /**
   * Output path or URI.
   *
   * Examples:
   * - ./data/dex-pool-datasets
   * - local://./data/dex-pool-datasets
   * - s3://bucket/prefix
   */
  out?: string;

  datasetId?: string;

  baseTimeframe?: Timeframe | string;
  timeframes?: Array<Timeframe | string>;

  chunkSize?: bigint | number | string;
  failFast?: boolean;
};
