import type { Command } from "commander";
import {
  getDiscoveryCacheStatus,
  getDiscoveryCachePaths,
  initializeDiscoveryCache,
  refreshDiscoveryCache,
  type DiscoveryCacheProgressEvent,
} from "../../discovery/uniswap-v3-factory-pool-cache.js";
import { getUniswapV3FactoryPreset } from "../../simple/uniswap-v3-factory-presets.js";
import { getSimpleChainPreset } from "../../simple/chain-presets.js";
import { resolveSimpleRpcUrl } from "../../simple/resolve-simple-build-config.js";
import type { DexChain } from "../../types/dex-pool-dataset.types.js";
import { printError, printLine } from "../cli-output.js";

type DiscoverCacheCommandOptions = {
  chain?: string;
  chainArg?: string;
  rpc?: string;
  rpcEnv?: string;
};

export async function runDiscoverCacheInitCommand(options: DiscoverCacheCommandOptions): Promise<void> {
  try {
    const chain = normalizeChain(options.chain ?? options.chainArg);
    const rpcUrl = resolveSimpleRpcUrl({ chain, rpcUrl: options.rpc, rpcUrlEnv: options.rpcEnv });
    const preset = getUniswapV3FactoryPreset(chain);
    const paths = getDiscoveryCachePaths({ chain });

    printLine(`Initializing Uniswap v3 factory pool cache for ${chain}`);
    printLine("");
    printLine(`Factory: ${preset.factoryAddress}`);
    printLine(`Deployment block: ${preset.deploymentBlock.toString()}`);

    const result = await initializeDiscoveryCache({
      chain,
      rpcUrl,
      onProgress: printCacheProgress,
    });

    printLine(`Latest safe block: ${result.state.safeLatestBlock}`);
    printLine("");
    printLine("Cache:");
    printLine(`  pools: ${paths.poolsPath}`);
    printLine(`  state: ${paths.statePath}`);
    printLine("");
    printLine(`Found pools: ${result.state.poolCount}`);
    printLine(`Scanned to block: ${result.state.scannedToBlock}`);
  } catch (error: unknown) {
    printError(formatCommandError("Discovery cache init failed", error));
    process.exit(1);
  }

  process.exit(0);
}

export async function runDiscoverCacheRefreshCommand(options: DiscoverCacheCommandOptions): Promise<void> {
  try {
    const chain = normalizeChain(options.chain ?? options.chainArg);
    const rpcUrl = resolveSimpleRpcUrl({ chain, rpcUrl: options.rpc, rpcUrlEnv: options.rpcEnv });

    printLine(`Refreshing Uniswap v3 factory pool cache for ${chain}`);
    printLine("");

    const result = await refreshDiscoveryCache({
      chain,
      rpcUrl,
      onProgress: printCacheProgress,
    });

    printLine(`Pools cached: ${result.state.poolCount}`);
    printLine(`Scanned to block: ${result.state.scannedToBlock}`);
  } catch (error: unknown) {
    printError(formatCommandError("Discovery cache refresh failed", error));
    process.exit(1);
  }

  process.exit(0);
}

export async function runDiscoverCacheStatusCommand(options: DiscoverCacheCommandOptions): Promise<void> {
  try {
    const chain = normalizeChain(options.chain ?? options.chainArg);
    const rpcUrl = resolveSimpleRpcUrl({ chain, rpcUrl: options.rpc, rpcUrlEnv: options.rpcEnv });
    const status = await getDiscoveryCacheStatus({ chain, rpcUrl });

    printLine(`Uniswap v3 discovery cache for ${chain}`);
    printLine("");
    printLine(`Factory: ${status.state.factoryAddress}`);
    printLine(`Pools cached: ${status.state.poolCount}`);
    printLine(`Scanned to block: ${status.state.scannedToBlock}`);
    printLine(`Latest safe block: ${status.safeLatestBlock.toString()}`);
    printLine(`Lag: ${status.lagBlocks.toString()} blocks`);
    printLine(`Updated at: ${status.state.updatedAt}`);
  } catch (error: unknown) {
    printError(formatCommandError("Discovery cache status failed", error));
    process.exit(1);
  }

  process.exit(0);
}

export function registerDiscoverCacheCommand(program: Command): void {
  const discoverCache = program
    .command("discover-cache")
    .description("Manage Uniswap v3 discovery cache");

  discoverCache
    .command("init [chain]")
    .description("Initialize Uniswap v3 factory pool cache")
    .option("--chain <chain>", "Chain, e.g. base")
    .option("--rpc <rpc>", "Direct RPC URL")
    .option("--rpc-env <rpcEnv>", "RPC environment variable name")
    .action(async (chainArg: string | undefined, opts: DiscoverCacheCommandOptions) => {
      await runDiscoverCacheInitCommand({ ...opts, chainArg });
    });

  discoverCache
    .command("status [chain]")
    .description("Show Uniswap v3 discovery cache status")
    .option("--chain <chain>", "Chain, e.g. base")
    .option("--rpc <rpc>", "Direct RPC URL")
    .option("--rpc-env <rpcEnv>", "RPC environment variable name")
    .action(async (chainArg: string | undefined, opts: DiscoverCacheCommandOptions) => {
      await runDiscoverCacheStatusCommand({ ...opts, chainArg });
    });

  discoverCache
    .command("refresh [chain]")
    .description("Refresh Uniswap v3 factory pool cache")
    .option("--chain <chain>", "Chain, e.g. base")
    .option("--rpc <rpc>", "Direct RPC URL")
    .option("--rpc-env <rpcEnv>", "RPC environment variable name")
    .action(async (chainArg: string | undefined, opts: DiscoverCacheCommandOptions) => {
      await runDiscoverCacheRefreshCommand({ ...opts, chainArg });
    });
}

function printCacheProgress(event: DiscoveryCacheProgressEvent): void {
  switch (event.type) {
    case "scan_start":
      printLine("");
      printLine("Scanning PoolCreated logs:");
      break;
    case "scan_chunk":
      printLine(`  chunk ${event.index}/${event.total} blocks ${event.fromBlock.toString()} – ${event.toBlock.toString()}`);
      break;
    case "scan_done":
      break;
  }
}

function normalizeChain(chain: string | undefined): DexChain {
  if (chain === undefined || chain.length === 0) {
    throw new Error("DISCOVERY_CHAIN_REQUIRED");
  }
  return getSimpleChainPreset(chain).chain;
}

function formatCommandError(prefix: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${prefix}: ${message}`;
}
