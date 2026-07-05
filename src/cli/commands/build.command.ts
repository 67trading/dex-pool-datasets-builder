import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import type { ResolvedDexBuildConfig } from "../../config/dex-build-config.types.js";
import { loadDexBuildConfig } from "../../config/load-dex-build-config.js";
import { resolveDexBuildConfig } from "../../config/resolve-dex-build-config.js";
import { validatePoolRegistry } from "../../registry/pool-registry.js";
import {
  parsePairsList,
  parsePoolsList,
} from "../../simple/normalize-simple-pool-selections.js";
import { resolveSimpleDexBuildConfig } from "../../simple/resolve-simple-build-config.js";
import {
  ALL_SUPPORTED_TIMEFRAMES,
  inferDirectOutputPath,
  parseSimpleTimeframes,
  resolveCliDateRange,
} from "../../simple/simple-cli-defaults.js";
import { parseDexSelector } from "../shared/selector.js";
import type {
  SimpleDexBuildInput,
  SimplePairSelectionInput,
  SimplePoolSelectionInput,
} from "../../simple/simple-build.types.js";
import { buildDexPoolDataset } from "../../orchestrator/build-dex-pool-dataset.js";
import type { DexBuildProgressEvent } from "../../orchestrator/dex-build-progress.types.js";
import type { DexBuildRunReport } from "../../orchestrator/dex-build-result.types.js";
import type { DexPoolQualitySummary } from "../../types/dex-pool-dataset.types.js";
import { printLine, printError, printJson } from "../cli-output.js";

export type BuildCommandOptions = {
  config?: string;
  registryConfig?: string;
  pool?: string;
  pools?: string;
  pair?: string;
  pairs?: string;
  output?: string;
  json?: boolean;
  verbose?: boolean;
  chain?: string;
  fee?: string;
  token0?: string;
  token1?: string;
  from?: string;
  to?: string;
  days?: string;
  rpc?: string;
  rpcEnv?: string;
  out?: string;
  base?: string;
  quote?: string;
  timeframes?: string;
  baseTimeframe?: string;
  chunkSize?: string;
  datasetId?: string;
  selector?: string;
  allTimeframes?: boolean;
  dryRun?: boolean;
};

function formatQualityFailures(quality: DexPoolQualitySummary): string {
  const failures: string[] = [];

  if (quality.reorgConflicts > 0) failures.push(`reorgConflicts: ${quality.reorgConflicts}`);
  if (quality.invalidLogs > 0) failures.push(`invalidLogs: ${quality.invalidLogs}`);
  if (quality.duplicateLogs > 0) failures.push(`duplicateLogs: ${quality.duplicateLogs}`);
  if (quality.missingBlockTimestamps > 0) failures.push(`missingBlockTimestamps: ${quality.missingBlockTimestamps}`);
  if (quality.incompleteBlockRanges > 0) failures.push(`incompleteBlockRanges: ${quality.incompleteBlockRanges}`);
  if (quality.extremeWickCandles > 0) failures.push(`extremeWickCandles: ${quality.extremeWickCandles}`);

  return failures.join(", ");
}

function printProgressEvent(event: DexBuildProgressEvent): void {
  switch (event.type) {
    case "build_start":
      printLine(`Starting build: ${event.datasetId}`);
      break;
    case "pool_start":
      printLine(`Processing pool ${event.poolId} (${event.poolAddress})`);
      break;
    case "logs_read_start":
      printLine(`Reading logs: ${event.chunks} chunks, blocks ${event.fromBlock} – ${event.toBlock}`);
      break;
    case "logs_chunk_start":
      printLine(`Reading logs chunk ${event.index}/${event.total}: ${event.fromBlock} – ${event.toBlock}`);
      break;
    case "logs_chunk_done":
      printLine(`Logs chunk ${event.index}/${event.total} done: ${event.logCount} logs`);
      break;
    case "timestamps_progress":
      printLine(
        `Fetching timestamps: ${event.done}${event.total > 0 ? `/${event.total}` : ""} ` +
          `(cache hits=${event.cacheHits}, misses=${event.cacheMisses})`,
      );
      break;
    case "swaps_decoded":
      printLine(`Decoded swaps: ${event.swaps}`);
      break;
    case "candles_build_start":
      printLine(`Building ${event.timeframe} candles...`);
      break;
    case "candles_fill_done":
      printLine(`Filled no-trade intervals: ${event.filledNoTradeIntervals}`);
      break;
    case "timeframe_aggregate_done":
      printLine(`Aggregated ${event.timeframe}: ${event.candles} candles`);
      break;
    case "write_start":
      printLine(`Writing output for ${event.poolId}...`);
      break;
    case "write_done":
      printLine(`Wrote ${event.objects} objects for ${event.poolId}`);
      break;
    case "build_done":
      printLine(`Build ${event.status}: ${event.datasetId}`);
      break;
  }
}

export function formatRunReport(report: DexBuildRunReport, verbose: boolean): string {
  const lines: string[] = [];
  const hasErrors = report.status === "failed";

  lines.push(hasErrors ? "Dataset build completed with errors" : "Dataset build completed");
  lines.push("");
  lines.push(`Dataset: ${report.datasetId}`);

  lines.push(`Output: ${report.config.outputUri}`);

  if (report.pools.length > 0) {
    lines.push("");
    lines.push("Pools:");

    for (const pool of report.pools) {
      const qualityLabel = pool.quality.passed ? "passed" : "FAILED";
      const statusIcon = pool.quality.passed ? "✓" : "✗";

      lines.push(` ${statusIcon} ${pool.poolId} (${pool.symbol})`);
      lines.push(`   Timeframes: ${pool.timeframes.join(", ")}`);

      if (pool.quality.passed) {
        lines.push(`   Quality: ${qualityLabel}`);
      } else {
        const failures = formatQualityFailures(pool.quality);
        lines.push(`   Quality: ${qualityLabel}${failures ? ` (${failures})` : ""}`);
      }

      if (pool.quality.noTradeIntervals > 0) {
        lines.push(`   Filled no-trade intervals: ${pool.quality.noTradeIntervals}`);
      }

      if (pool.writtenObjects.length > 0) {
        lines.push("   Objects:");
        for (const obj of pool.writtenObjects) {
          const parts = obj.key.split("/");
          const shortKey = parts.length >= 2 ? parts.slice(-2).join("/") : obj.key;
          lines.push(`    ${shortKey}`);
        }
      }

      if (verbose) {
        lines.push(`   Block range: ${pool.blockRange.fromBlock} – ${pool.blockRange.toBlock}`);
      }
    }
  }

  if (report.fatalErrors.length > 0) {
    lines.push("");
    lines.push("Fatal errors:");
    for (const err of report.fatalErrors) {
      lines.push(` - [${err.code}] ${err.message}`);
    }
  }

  return lines.join("\n");
}

export async function runBuildCommand(options: BuildCommandOptions): Promise<void> {
  const { json, verbose } = options;

  let resolved: ResolvedDexBuildConfig;

  try {
    resolved = options.registryConfig !== undefined
      ? await resolveRegistryBuildConfigFromFile(options)
      : options.config !== undefined
        ? await resolveBuildConfigFromFile(options)
        : await resolveSimpleBuildConfigFromCli(options);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (json === true) {
      printJson({ error: message });
    } else {
      printError(`Error resolving build: ${message}`);
    }
    process.exit(1);
  }

  if (options.dryRun === true) {
    if (json === true) {
      printJson(buildDryRunSummary(resolved));
    } else {
      printLine(formatDryRunSummary(resolved));
    }
    process.exit(0);
  }

  let runReport: DexBuildRunReport;
  let status: "completed" | "failed";

  try {
    ({ runReport, status } = await buildDexPoolDataset(resolved, {
      onProgress: verbose === true && json !== true ? printProgressEvent : undefined,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (json === true) {
      printJson({ error: message });
    } else {
      printError(`Build failed: ${message}`);
    }
    process.exit(1);
  }

  if (json === true) {
    printJson(runReport);
  } else {
    printLine(formatRunReport(runReport, verbose === true));
  }

  process.exit(status === "completed" ? 0 : 1);
}

async function resolveBuildConfigFromFile(options: BuildCommandOptions): Promise<ResolvedDexBuildConfig> {
  if (options.config === undefined) {
    throw new Error("CONFIG_PATH_REQUIRED");
  }

  const rawConfig = await loadSimpleBuildConfig(options.config);
  return resolveSimpleDexBuildConfig(simpleInputFromConfig(rawConfig, options));
}

/**
 * Registry-based config path: network/registry/build JSON (see
 * config/dex-dataset.*.example.json) + a separate pool-registry JSON file.
 *
 * This is the only build path for chains without a "simple mode" resolver
 * (e.g. Solana — there is no factory/getPool equivalent to resolve a pair
 * selector on-chain), so pools are declared explicitly in the registry.
 */
async function resolveRegistryBuildConfigFromFile(options: BuildCommandOptions): Promise<ResolvedDexBuildConfig> {
  if (options.registryConfig === undefined) {
    throw new Error("REGISTRY_CONFIG_PATH_REQUIRED");
  }

  const rawConfig = await loadDexBuildConfig(options.registryConfig);
  const resolved = resolveDexBuildConfig({
    config: rawConfig,
    outputOverride: options.output ?? options.out,
  });

  const registryRaw = await readFile(rawConfig.registry.path, "utf8").catch((error: unknown) => {
    throw new Error(`REGISTRY_NOT_FOUND:${rawConfig.registry.path}`, { cause: error });
  });

  let registryParsed: unknown;
  try {
    registryParsed = JSON.parse(registryRaw);
  } catch (error) {
    throw new Error(`REGISTRY_PARSE_ERROR:${rawConfig.registry.path}`, { cause: error });
  }

  const { pools, errors } = validatePoolRegistry(registryParsed);
  if (errors.length > 0) {
    throw new Error(`POOL_REGISTRY_INVALID: ${errors.join(", ")}`);
  }

  return {
    ...resolved,
    registryPools: pools,
  };
}

async function resolveSimpleBuildConfigFromCli(options: BuildCommandOptions): Promise<ResolvedDexBuildConfig> {
  const parsedSelector = parseDexSelector(options.selector);
  const chain = options.chain ?? parsedSelector?.chain;
  const pair = options.pair ?? parsedSelector?.pair;
  const pool = options.pool ?? parsedSelector?.pool;

  if (chain === undefined) {
    throw new Error("SIMPLE_CHAIN_REQUIRED");
  }

  const dateRange = resolveCliDateRange({
    from: options.from,
    to: options.to,
    days: options.days,
  });

  if (dateRange.from === undefined) {
    throw new Error("SIMPLE_FROM_OR_DAYS_REQUIRED");
  }

  const timeframes = resolveTimeframes({
    timeframes: options.timeframes,
    allTimeframes: options.allTimeframes,
  });

  const out = options.out ?? options.output ?? inferDirectOutputPath({
    chain,
    pair,
    pool,
    from: dateRange.from,
    to: dateRange.to,
    days: dateRange.days,
  });

  return resolveSimpleDexBuildConfig({
    chain,
    pool,
    pools: parsePoolsList(options.pools),
    pair,
    pairs: parsePairsList(options.pairs),
    fee: options.fee,
    token0: options.token0,
    token1: options.token1,
    from: dateRange.from,
    to: dateRange.to,
    days: dateRange.days,
    rpcUrl: options.rpc,
    rpcUrlEnv: options.rpcEnv,
    out,
    base: options.base,
    quote: options.quote,
    datasetId: options.datasetId,
    baseTimeframe: options.baseTimeframe,
    timeframes,
    chunkSize: options.chunkSize,
    failFast: true,
  });
}

function simpleInputFromConfig(rawConfig: unknown, options: BuildCommandOptions): SimpleDexBuildInput {
  if (!isRecord(rawConfig)) {
    throw new Error("SIMPLE_CONFIG_NOT_OBJECT");
  }

  const rpc = typeof rawConfig.rpc === "string" ? rawConfig.rpc : undefined;
  const cliPairs = parsePairsList(options.pairs);
  const cliPools = parsePoolsList(options.pools);
  return {
      chain: options.chain ?? requiredString(rawConfig.chain, "chain"),
      pool: options.pool ?? optionalString(rawConfig.pool),
      pools: cliPools ?? parseStringArray(rawConfig.pools),
      pair: options.pair ?? optionalString(rawConfig.pair),
      pairs: cliPairs ?? parsePairsConfig(rawConfig.pairs),
      fee: options.fee ?? optionalStringOrNumber(rawConfig.fee),
      token0: options.token0 ?? optionalString(rawConfig.token0),
      token1: options.token1 ?? optionalString(rawConfig.token1),
      symbols: parseSymbolsConfig(rawConfig.symbols),
      from: options.from ?? requiredString(rawConfig.from, "from"),
      to: options.to ?? optionalString(rawConfig.to),
      days: options.days !== undefined ? Number(options.days) : optionalNumber(rawConfig.days),
      rpcUrl: options.rpc ?? (rpc !== undefined && !rpc.startsWith("env:") ? rpc : undefined),
      rpcUrlEnv: options.rpcEnv ?? (rpc?.startsWith("env:") ? rpc.slice("env:".length) : optionalString(rawConfig.rpcUrlEnv)),
      out: options.out ?? options.output ?? optionalString(rawConfig.out),
      base: options.base ?? optionalString(rawConfig.base),
      quote: options.quote ?? optionalString(rawConfig.quote),
      datasetId: options.datasetId ?? optionalString(rawConfig.datasetId),
      baseTimeframe: options.baseTimeframe ?? optionalString(rawConfig.baseTimeframe),
      timeframes: resolveTimeframes({
        timeframes: options.timeframes,
        allTimeframes: options.allTimeframes,
      }) ??
        (Array.isArray(rawConfig.timeframes) ? rawConfig.timeframes.map((value) => String(value)) : undefined),
      chunkSize: options.chunkSize ?? optionalStringOrNumber(rawConfig.chunkSize),
      failFast: typeof rawConfig.failFast === "boolean" ? rawConfig.failFast : true,
    };
}

async function loadSimpleBuildConfig(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as unknown;
}

function buildDryRunSummary(resolved: ResolvedDexBuildConfig): unknown {
  return {
    dryRun: true,
    datasetId: resolved.datasetId,
    output: resolved.output,
    network: {
      chain: resolved.network.chain,
      chainId: resolved.network.chainId,
      finality: resolved.network.finality,
    },
    build: {
      pools: resolved.build.pools,
      fromBlock: resolved.build.fromBlock.toString(),
      toBlock: resolved.build.toBlock.toString(),
      requestedToBlock: resolved.build.requestedToBlock?.toString(),
      finalizedToBlock: resolved.build.finalizedToBlock?.toString(),
      clippedToFinality: resolved.build.clippedToFinality,
      baseTimeframe: resolved.build.baseTimeframe,
      timeframes: resolved.build.timeframes,
      chunkSize: resolved.build.chunkSize.toString(),
    },
    willWrite: false,
  };
}

function formatDryRunSummary(resolved: ResolvedDexBuildConfig): string {
  const lines: string[] = [];

  lines.push("Build dry run");
  lines.push("");
  lines.push(`Dataset: ${resolved.datasetId}`);
  lines.push(`Network: ${resolved.network.chain} / chainId ${resolved.network.chainId}`);
  lines.push(`Output: ${resolved.output.uri}`);
  lines.push(`Block range: ${resolved.build.fromBlock.toString()} – ${resolved.build.toBlock.toString()}`);
  lines.push(`Base timeframe: ${resolved.build.baseTimeframe}`);
  lines.push(`Output timeframes: ${resolved.build.timeframes.join(", ")}`);
  lines.push(`Pools: ${resolved.build.pools.join(", ")}`);
  lines.push("");
  lines.push("No dataset objects will be written.");

  return lines.join("\n");
}

function resolveTimeframes(input: {
  timeframes?: string;
  allTimeframes?: boolean;
}) {
  if (input.timeframes !== undefined && input.allTimeframes === true) {
    throw new Error("SIMPLE_TIMEFRAMES_CONFLICT: use either --timeframes or --all-timeframes, not both");
  }

  if (input.allTimeframes === true) {
    return ALL_SUPPORTED_TIMEFRAMES;
  }

  return parseSimpleTimeframes(input.timeframes);
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map((item) => String(item)).filter((item) => item.length > 0);
}

function parsePairsConfig(value: unknown): SimplePairSelectionInput[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((item) => {
    if (typeof item === "string") {
      return item;
    }

    if (isRecord(item)) {
      return {
        pair: requiredString(item.pair, "pairs[].pair"),
        fee: optionalStringOrNumber(item.fee),
        base: optionalString(item.base),
        quote: optionalString(item.quote),
      };
    }

    throw new Error("SIMPLE_CONFIG_PAIR_INVALID");
  });
}

function parseSymbolsConfig(value: unknown): SimplePoolSelectionInput[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error("SIMPLE_CONFIG_SYMBOL_INVALID");
    }

    return {
      pool: optionalString(item.pool),
      pair: optionalString(item.pair),
      fee: optionalStringOrNumber(item.fee),
      token0: optionalString(item.token0),
      token1: optionalString(item.token1),
      base: optionalString(item.base),
      quote: optionalString(item.quote),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`SIMPLE_CONFIG_FIELD_REQUIRED:${field}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringOrNumber(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function registerBuildCommand(program: Command): void {
  program
    .command("build [selector]")
    .description("Build a DEX pool dataset. Example: dex-pool build base:WETH/USDC --fee 500 --days 30")
    .option("-c, --config <config>", "Path to dex-pool.config.json")
    .option(
      "--registry-config <registryConfig>",
      "Path to a registry-based dex-dataset config (network+registry+build JSON); required for chains without simple-mode support, e.g. solana",
    )
    .option("--pool <pool>", "Pool contract address")
    .option("--pools <pools>", "Comma-separated pool contract addresses")
    .option("--pair <pair>", "Pair selector, e.g. WETH/USDC")
    .option("--pairs <pairs>", "Comma-separated pair selectors, e.g. WETH/USDC,cbBTC/WETH:3000")
    .option("--fee <fee>", "Uniswap v3 fee tier, e.g. 500")
    .option("--token0 <token0>", "token0/tokenA address for factory.getPool")
    .option("--token1 <token1>", "token1/tokenB address for factory.getPool")
    .option("--output <output>", "Output URI override, local:// or s3://")
    .option("--json", "Output run report as JSON")
    .option("--verbose", "Verbose output")
    .option("--chain <chain>", "Chain, e.g. base")
    .option("--from <from>", "From date/time, e.g. 2024-01-01")
    .option("--to <to>", "Exclusive to date/time, e.g. 2024-02-01")
    .option("--days <days>", "Duration in days when --to is omitted")
    .option("--rpc <rpc>", "Direct RPC URL")
    .option("--rpc-env <rpcEnv>", "RPC environment variable name")
    .option("--out <out>", "Output path or URI")
    .option("--base <base>", "Base token selector, e.g. WETH")
    .option("--quote <quote>", "Quote token selector, e.g. USDC")
    .option("--timeframes <timeframes>", "Comma-separated timeframes, e.g. 1m,5m,15m,1h")
    .option("--all-timeframes", "Build all supported timeframes: 1m,3m,5m,15m,30m,1h,4h,1d")
    .option("--base-timeframe <baseTimeframe>", "Base timeframe, default 1m")
    .option("--chunk-size <chunkSize>", "eth_getLogs chunk size in blocks")
    .option("--dataset-id <datasetId>", "Dataset ID override")
    .option("--dry-run", "Resolve and print the build plan without writing dataset objects")
    .action(async (selector: string | undefined, opts: BuildCommandOptions) => {
      await runBuildCommand({ ...opts, selector });
    });
}
