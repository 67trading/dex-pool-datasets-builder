import type { Command } from "commander";
import type {
  DiscoveryMetric,
  UniswapV3RpcDiscoveryProgressEvent,
  UniswapV3RpcResolvedRange,
} from "../../discovery/discovery.types.js";
import {
  discoverTopUniswapV3Pools,
  normalizeDiscoveryMetric,
} from "../../discovery/uniswap-v3-rpc-discovery.js";
import {
  discoveryCacheExists,
  isDiscoveryCacheMissingError,
  loadDiscoveryCache,
} from "../../discovery/uniswap-v3-factory-pool-cache.js";
import { getSimpleChainPreset } from "../../simple/chain-presets.js";
import { resolveSimpleRpcUrl } from "../../simple/resolve-simple-build-config.js";
import type { DexChain } from "../../types/dex-pool-dataset.types.js";
import { printError, printJson, printLine } from "../cli-output.js";

type DiscoveredPools = Awaited<ReturnType<typeof discoverTopUniswapV3Pools>>;
type DiscoveryCache = Awaited<ReturnType<typeof loadDiscoveryCache>>;

type DiscoverCommandOptions = {
  chain?: string;
  chainArg?: string;
  top?: string;
  by?: string;
  lookbackDays?: string;
  quote?: string;
  json?: boolean;
  rpc?: string;
  rpcEnv?: string;
  printBuildCommands?: boolean;
  buildDays?: string;
  allTimeframes?: boolean;
  out?: string;
};

export async function runDiscoverCommand(options: DiscoverCommandOptions): Promise<void> {
  let chain: DexChain;
  let metric: DiscoveryMetric;
  let lookbackDays: number;
  let pools: DiscoveredPools;
  let cache: DiscoveryCache;
  let cacheLagBlocks: bigint | undefined;
  let resolvedRange: UniswapV3RpcResolvedRange | undefined;

  try {
    chain = normalizeChain(options.chain ?? options.chainArg);
    metric = normalizeDiscoveryMetric(options.by ?? "swapCount");
    lookbackDays = parsePositiveInteger(options.lookbackDays ?? "7", "lookback-days");

    if (metric === "quoteVolume" && options.quote === undefined) {
      throw new Error("DISCOVERY_QUOTE_REQUIRED: --quote is required when --by quoteVolume");
    }

    const top = parsePositiveInteger(options.top ?? "10", "top");


    const rpcUrl = resolveSimpleRpcUrl({
      chain,
      rpcUrl: options.rpc,
      rpcUrlEnv: options.rpcEnv,
    });

    const cacheExists = await discoveryCacheExists({ chain });

    if (!cacheExists) {
      throw new Error(formatCacheMissingError(chain, top, options));
    }

    try {
      cache = await loadDiscoveryCache({ chain });
    } catch (error: unknown) {
      if (isDiscoveryCacheMissingError(error)) {
        throw new Error(formatCacheMissingError(chain, top, options));
      }
      throw error;
    }

    pools = await discoverTopUniswapV3Pools({
      source: "uniswap_v3_rpc",
      chain,
      rpcUrl,
      candidates: cache.candidates,
      top: {
        by: metric,
        limit: top,
        lookbackDays,
      },
      quote: options.quote,
      onProgress: options.json === true ? undefined : printScoringProgress,
      onResolvedRange: (range) => {
        resolvedRange = range;
      },
    });

    cacheLagBlocks = resolvedRange === undefined
      ? undefined
      : calculateCacheLagBlocks(cache.state.scannedToBlock, resolvedRange.toBlock);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json === true) {
      printJson({ error: message });
    } else {
      printError(`Discovery failed: ${message}`);
    }
    process.exit(1);
  }

  if (options.json === true) {
    printJson({
      chain,
      source: "uniswap_v3_rpc",
      metric,
      lookbackDays,
      quote: options.quote,
      factoryAddress: cache.state.factoryAddress,
      factoryDeploymentBlock: cache.state.deploymentBlock,
      cache: {
        poolCount: cache.rows.length,
        scannedToBlock: cache.state.scannedToBlock,
        lagBlocks: cacheLagBlocks?.toString(),
      },
      blockRange: resolvedRange !== undefined
        ? {
            fromBlock: resolvedRange.fromBlock,
            toBlock: resolvedRange.toBlock,
          }
        : pools[0] !== undefined
          ? {
              fromBlock: pools[0].discovery.fromBlock,
              toBlock: pools[0].discovery.toBlock,
            }
          : undefined,
      snapshotAt: pools[0]?.discovery.snapshotAt ?? new Date().toISOString(),
      pools,
    });
  } else {
    if (cacheLagBlocks !== undefined && cacheLagBlocks > 10_000n) {
      printError(
        `Discovery cache is ${cacheLagBlocks.toString()} blocks behind latest safe block.\n` +
          `Run: dex-pool discover-cache refresh ${chain}`,
      );
    }

    printLine(
      `Loaded discovery cache for ${chain}:\n` +
        `  pools: ${cache.rows.length}\n` +
        `  scannedToBlock: ${cache.state.scannedToBlock}\n`,
    );
    printLine(`Scoring recent Swap logs over last ${lookbackDays} days...\n`);
    printLine(formatDiscoveredPoolsTable({ pools, metric, lookbackDays, quote: options.quote }));

    if (options.printBuildCommands === true) {
      printLine("");
      printLine("Build commands:");
      printLine(formatBuildCommands({
        chain,
        pools,
        buildDays: options.buildDays ?? "30",
        allTimeframes: options.allTimeframes === true,
        out: options.out,
      }));
    }
  }

  process.exit(0);
}

function printScoringProgress(event: UniswapV3RpcDiscoveryProgressEvent): void {
  switch (event.type) {
    case "score_start":
      printLine(`Scoring ${event.candidateCount} cached pools across ${event.batches} batches and ${event.ranges} block ranges.`);
      break;
    case "score_batch":
      printLine(`  scoring batch ${event.batchIndex}/${event.batchTotal} (${event.addressCount} pools)`);
      break;
    case "score_range":
      printLine(`  range ${event.rangeIndex}/${event.rangeTotal} blocks ${event.fromBlock} - ${event.toBlock}`);
      break;
    case "score_done":
      printLine(`Scored pools with swaps: ${event.scoredPools}`);
      printLine("");
      break;
  }
}

function calculateCacheLagBlocks(scannedToBlock: string, latestScoringBlock: string): bigint {
  const scanned = BigInt(scannedToBlock);
  const latest = BigInt(latestScoringBlock);
  return latest > scanned ? latest - scanned : 0n;
}

function formatDiscoveredPoolsTable(input: {
  pools: DiscoveredPools;
  metric: DiscoveryMetric;
  lookbackDays: number;
  quote: string | undefined;
}): string {
  const header = input.metric === "quoteVolume"
    ? `Top Uniswap v3 pools by quoteVolume(${input.quote}) over last ${input.lookbackDays} days`
    : `Top active Uniswap v3 pools by swapCount over last ${input.lookbackDays} days`;
  const valueHeader = input.metric === "quoteVolume" ? `QuoteVolume(${input.quote})` : "Swaps";

  const rows = [
    ["Rank", "Pair", "Fee", valueHeader, "Pool"],
    ...input.pools.map((item) => [
      String(item.rank),
      item.discovery.pair,
      String(item.discovery.feeTier),
      item.metricValue,
      item.discovery.poolAddress,
    ]),
  ];

  const widths = rows[0]!.map((_, index) => Math.max(...rows.map((row) => row[index]!.length)));
  const table = rows
    .map((row) => row.map((cell, index) => cell.padEnd(widths[index]!)).join(" ").trimEnd())
    .join("\n");

  return `${header}\n\n${table}`;
}


function formatBuildCommands(input: {
  chain: DexChain;
  pools: DiscoveredPools;
  buildDays: string;
  allTimeframes: boolean;
  out?: string;
}): string {
  return input.pools
    .map((item) => {
      const parts = [
        "dex-pool build",
        `${input.chain}:${item.discovery.pair}`,
        `--fee ${item.discovery.feeTier}`,
        `--days ${input.buildDays}`,
        input.allTimeframes ? "--all-timeframes" : undefined,
        input.out !== undefined ? `--out ${input.out}` : undefined,
      ].filter(Boolean);

      return parts.join(" ");
    })
    .join("\n");
}

function normalizeChain(chain: string | undefined): DexChain {
  if (chain === undefined || chain.length === 0) {
    throw new Error("DISCOVERY_CHAIN_REQUIRED");
  }
  return getSimpleChainPreset(chain).chain;
}

function parsePositiveInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`DISCOVERY_INTEGER_INVALID:${field}:${value}`);
  }
  return parsed;
}

export function registerDiscoverCommand(program: Command): void {
  program
    .command("discover [chain]")
    .description("Discover active Uniswap v3 pools from recent RPC logs")
    .option("--chain <chain>", "Chain, e.g. base")
    .option("--rpc <rpc>", "Direct RPC URL")
    .option("--rpc-env <rpcEnv>", "RPC environment variable name")
    .option("--top <top>", "Number of pools to return, default 10")
    .option("--by <by>", "Discovery metric: swapCount or quoteVolume. Default: swapCount.")
    .option("--lookback-days <lookbackDays>", "Recent lookback window for activity scoring. Default: 7.")
    .option("--quote <quote>", "Quote token used for quoteVolume, e.g. USDC.")
    .option("--json", "Output JSON")
    .option("--print-build-commands", "Print copy-paste dex-pool build commands for the discovered pools")
    .option("--build-days <buildDays>", "Days to use in printed build commands. Default: 30.")
    .option("--all-timeframes", "Include --all-timeframes in printed build commands")
    .option("--out <out>", "Include --out in printed build commands")
    .action(async (chainArg: string | undefined, opts: DiscoverCommandOptions) => {
      await runDiscoverCommand({ ...opts, chainArg });
    });
}

function formatCacheMissingError(
  chain: DexChain,
  top: number,
  options: DiscoverCommandOptions,
): string {
  const baseCommand = [
    "dex-pool discover",
    chain,
    options.rpc !== undefined ? `--rpc ${options.rpc}` : undefined,
    options.rpcEnv !== undefined ? `--rpc-env ${options.rpcEnv}` : undefined,
    `--top ${top}`,
    options.by !== undefined ? `--by ${options.by}` : undefined,
    options.lookbackDays !== undefined ? `--lookback-days ${options.lookbackDays}` : undefined,
    options.quote !== undefined ? `--quote ${options.quote}` : undefined,
    options.printBuildCommands === true ? "--print-build-commands" : undefined,
    options.buildDays !== undefined ? `--build-days ${options.buildDays}` : undefined,
    options.allTimeframes === true ? "--all-timeframes" : undefined,
    options.out !== undefined ? `--out ${options.out}` : undefined,
  ].filter(Boolean).join(" ");

  return (
    `DISCOVERY_CACHE_MISSING:${chain}\n\n` +
    "Discovery uses the local Uniswap v3 factory pool cache, but that cache is not initialized.\n" +
    "Cache initialization can take a long time, so it is intentionally a separate explicit step.\n\n" +
    "Run once before discovery:\n" +
    `  dex-pool discover-cache init ${chain}\n\n` +
    "Then run discovery again:\n" +
    `  ${baseCommand}`
  );
}
