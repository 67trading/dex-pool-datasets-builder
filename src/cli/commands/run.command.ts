import type { Command } from "commander";
import { runBuildCommand, type BuildCommandOptions } from "./build.command.js";

type RunCommandOptions = Omit<BuildCommandOptions, "config" | "output">;

export async function runHappyPathCommand(
  selector: string | undefined,
  options: RunCommandOptions,
): Promise<void> {
  await runBuildCommand({
    ...options,
    selector,
  });
}

export function registerRunCommand(program: Command): void {
  program
    .command("run [selector]")
    .description("Resolve and build a DEX pool dataset. Example: dex-pool run base:WETH/USDC --fee 500 --days 30")
    .option("--chain <chain>", "Chain, e.g. base")
    .option("--pool <pool>", "Pool contract address")
    .option("--pools <pools>", "Comma-separated pool contract addresses")
    .option("--pair <pair>", "Pair selector, e.g. WETH/USDC")
    .option("--pairs <pairs>", "Comma-separated pair selectors, e.g. WETH/USDC,cbBTC/WETH:3000")
    .option("--fee <fee>", "Uniswap v3 fee tier, e.g. 500")
    .option("--token0 <token0>", "token0/tokenA address for factory.getPool")
    .option("--token1 <token1>", "token1/tokenB address for factory.getPool")
    .option("--from <from>", "From date/time, e.g. 2024-01-01")
    .option("--to <to>", "Exclusive to date/time, e.g. 2024-02-01")
    .option("--days <days>", "Duration in days. If --from is omitted, builds the last N days ending at --to or now.")
    .option("--rpc <rpc>", "Direct RPC URL")
    .option("--rpc-env <rpcEnv>", "RPC environment variable name")
    .option("--out <out>", "Output path or URI")
    .option("--base <base>", "Base token selector, e.g. WETH")
    .option("--quote <quote>", "Quote token selector, e.g. USDC")
    .option("--timeframes <timeframes>", "Comma-separated timeframes")
    .option("--all-timeframes", "Build all supported timeframes: 1m,3m,5m,15m,30m,1h,4h,1d")
    .option("--base-timeframe <baseTimeframe>", "Base timeframe")
    .option("--chunk-size <chunkSize>", "eth_getLogs chunk size in blocks")
    .option("--dataset-id <datasetId>", "Dataset ID override")
    .option("--dry-run", "Resolve and print the build plan without writing dataset objects")
    .option("--json", "Output run report as JSON")
    .option("--verbose", "Verbose output")
    .action(async (selector: string | undefined, opts: RunCommandOptions) => {
      await runHappyPathCommand(selector, opts);
    });
}
