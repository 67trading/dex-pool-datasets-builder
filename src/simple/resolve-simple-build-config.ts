import type { Timeframe } from "../contracts/timeframe.js";
import { ALL_TIMEFRAMES } from "../contracts/timeframe.js";
import type { ResolvedDexBuildConfig } from "../config/dex-build-config.types.js";
import type {
  DexChain,
  DexPoolConfig,
} from "../types/dex-pool-dataset.types.js";
import type { DexPoolSelectionMetadata } from "./pool-selection-metadata.types.js";
import { createEvmJsonRpcClient } from "../evm/evm-json-rpc-client.js";
import { getSimpleChainPreset } from "./chain-presets.js";
import { readUniswapV3PoolConfig } from "./evm-contract-reader.js";
import { normalizeSimplePoolSelections } from "./normalize-simple-pool-selections.js";
import { resolveDateBlockRange } from "./resolve-date-block-range.js";
import { resolvePoolSelection } from "./resolve-pool-selection.js";
import type { SimpleDexBuildInput } from "./simple-build.types.js";

const DEFAULT_BASE_TIMEFRAME: Timeframe = "1m";
const DEFAULT_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h"];
const DEFAULT_OUTPUT = "./data/dex-pool-datasets";
const DEFAULT_CACHE_DIR = ".data/cache";

export async function resolveSimpleDexBuildConfig(
  input: SimpleDexBuildInput,
): Promise<ResolvedDexBuildConfig> {
  const preset = getSimpleChainPreset(input.chain);

  const rpcUrl = resolveSimpleRpcUrl({
    chain: input.chain,
    rpcUrl: input.rpcUrl,
    rpcUrlEnv: input.rpcUrlEnv,
  });

  const client = createEvmJsonRpcClient({ rpcUrl });

  const actualChainId = await client.getChainId();

  if (actualChainId !== BigInt(preset.chainId)) {
    throw new Error(
      `SIMPLE_CHAIN_ID_MISMATCH:${preset.chainId}:${actualChainId.toString()}`,
    );
  }

  const from = input.from;
  const to = input.to ?? deriveToDate(input.from, input.days);

  const blockRange = await resolveDateBlockRange({
    client,
    from,
    to,
  });

  const finality = applyFinality({
    toBlock: blockRange.toBlock,
    latestBlock: blockRange.latestBlock,
    confirmations: preset.finalityConfirmations,
  });

  const selections = normalizeSimplePoolSelections(input);
  const poolById = new Map<string, DexPoolConfig>();
  const poolSelectionByPoolId: Record<string, DexPoolSelectionMetadata> = {};

  for (const selection of selections) {
    const poolSelection = await resolvePoolSelection({
      client,
      chain: preset.chain,
      pool: selection.pool,
      pair: selection.pair,
      fee: selection.fee,
      token0: selection.token0,
      token1: selection.token1,
      base: selection.base,
      quote: selection.quote,
    });

    const pool = await readUniswapV3PoolConfig({
      client,
      chain: preset.chain,
      poolAddress: poolSelection.poolAddress,
      startBlock: blockRange.fromBlock.toString(),
      base: poolSelection.base ?? selection.base,
      quote: poolSelection.quote ?? selection.quote,
    });

    poolById.set(pool.id, pool);
    poolSelectionByPoolId[pool.id] = poolSelection.metadata;
  }

  const pools = [...poolById.values()];

  if (pools.length === 0) {
    throw new Error("SIMPLE_NO_POOLS_RESOLVED");
  }

  const timeframes = normalizeTimeframes(
    input.timeframes ?? DEFAULT_TIMEFRAMES,
  );
  const baseTimeframe = normalizeTimeframe(
    input.baseTimeframe ?? DEFAULT_BASE_TIMEFRAME,
  );

  if (!timeframes.includes(baseTimeframe)) {
    timeframes.unshift(baseTimeframe);
  }

  const outputUri = normalizeOutputUri(input.out ?? DEFAULT_OUTPUT);

  const datasetId =
    input.datasetId ??
    buildSimpleDatasetId({
      chain: preset.chain,
      pools,
      from,
      to,
    });

  return {
    datasetId,
    registryPath: "<runtime:simple>",
    registryPools: pools,
    poolSelectionByPoolId,

    network: {
      chain: preset.chain,
      chainId: preset.chainId,
      rpcUrl,
      finality: {
        mode: "confirmation_lag",
        confirmations: preset.finalityConfirmations,
      },
    },

    build: {
      pools: pools.map((pool) => pool.id),
      fromBlock: blockRange.fromBlock,
      toBlock: finality.toBlock,
      requestedToBlock: finality.requestedToBlock,
      finalizedToBlock: finality.finalizedToBlock,
      clippedToFinality: finality.clippedToFinality,
      baseTimeframe,
      timeframes,
      chunkSize: normalizeChunkSize(input.chunkSize ?? "5000"),
      failFast: input.failFast ?? true,
    },

    output: {
      type: outputUri.startsWith("s3://") ? "s3" : "local",
      uri: outputUri,
    },

    profile: "simple",
    cacheDir: DEFAULT_CACHE_DIR,
  };
}

export function resolveSimpleRpcUrl(input: {
  chain: string;
  rpcUrl?: string;
  rpcUrlEnv?: string;
}): string {
  if (input.rpcUrl !== undefined && input.rpcUrl.length > 0) {
    return input.rpcUrl;
  }

  const preset = getSimpleChainPreset(input.chain);
  const envName = input.rpcUrlEnv ?? preset.defaultRpcUrlEnv;
  const rpcUrl = process.env[envName];

  if (rpcUrl === undefined || rpcUrl.length === 0) {
    throw new Error(`SIMPLE_RPC_ENV_MISSING:${envName}`);
  }

  return rpcUrl;
}

function applyFinality(input: {
  toBlock: bigint;
  latestBlock: bigint;
  confirmations: number;
}): {
  toBlock: bigint;
  requestedToBlock: bigint;
  finalizedToBlock: bigint;
  clippedToFinality: boolean;
} {
  const safeToBlock =
    input.latestBlock > BigInt(input.confirmations)
      ? input.latestBlock - BigInt(input.confirmations)
      : 0n;

  const effectiveToBlock =
    input.toBlock > safeToBlock ? safeToBlock : input.toBlock;

  return {
    toBlock: effectiveToBlock,
    requestedToBlock: input.toBlock,
    finalizedToBlock: safeToBlock,
    clippedToFinality: effectiveToBlock !== input.toBlock,
  };
}

function deriveToDate(from: string, days: number | undefined): string {
  if (days === undefined) {
    throw new Error("SIMPLE_TO_OR_DAYS_REQUIRED");
  }

  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`SIMPLE_DAYS_INVALID:${days}`);
  }

  const ms = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00.000Z` : from,
  );

  if (!Number.isFinite(ms)) {
    throw new Error(`SIMPLE_DATE_INVALID:${from}`);
  }

  return new Date(ms + days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeTimeframe(value: Timeframe | string): Timeframe {
  if ((ALL_TIMEFRAMES as string[]).includes(value)) {
    return value as Timeframe;
  }

  throw new Error(`SIMPLE_TIMEFRAME_INVALID:${value}`);
}

function normalizeTimeframes(values: Array<Timeframe | string>): Timeframe[] {
  if (values.length === 0) {
    throw new Error("SIMPLE_TIMEFRAMES_EMPTY");
  }

  return values.map(normalizeTimeframe);
}

function normalizeChunkSize(value: bigint | number | string): bigint {
  const parsed = BigInt(value);

  if (parsed <= 0n) {
    throw new Error(`SIMPLE_CHUNK_SIZE_INVALID:${String(value)}`);
  }

  return parsed;
}

function normalizeOutputUri(value: string): string {
  if (value.startsWith("local://") || value.startsWith("s3://")) {
    return value;
  }

  return `local://${value}`;
}

function buildSimpleDatasetId(input: {
  chain: DexChain;
  pools: DexPoolConfig[];
  from: string;
  to: string;
}): string {
  const fromPart = input.from.slice(0, 10).replace(/[^0-9]/g, "");
  const toPart = input.to.slice(0, 10).replace(/[^0-9]/g, "");

  if (input.pools.length === 1) {
    return `${input.pools[0]!.id}-${fromPart}-${toPart}`;
  }

  return `${input.chain}-dex-pools-${fromPart}-${toPart}`;
}
