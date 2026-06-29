import { access, writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { getSimpleChainPreset } from "../../simple/chain-presets.js";
import {
  ALL_SUPPORTED_TIMEFRAMES,
  inferSimpleDatasetId,
  parseSimpleTimeframes,
} from "../../simple/simple-cli-defaults.js";
import {
  parsePairsList,
  parsePoolsList,
} from "../../simple/normalize-simple-pool-selections.js";
import { printError, printLine } from "../cli-output.js";

type InitCommandOptions = {
  file?: string;
  chain?: string;
  pool?: string;
  pools?: string;
  pair?: string;
  pairs?: string;
  fee?: string;
  from?: string;
  to?: string;
  rpc?: string;
  rpcEnv?: string;
  out?: string;
  base?: string;
  quote?: string;
  timeframes?: string;
  allTimeframes?: boolean;
  baseTimeframe?: string;
  datasetId?: string;
  force?: boolean;
};

export async function runInitCommand(options: InitCommandOptions): Promise<void> {
  const file = options.file ?? "dex-pool.config.json";
  const chain = options.chain ?? "base";
  const preset = getSimpleChainPreset(chain);

  if (options.force !== true && (await exists(file))) {
    printError(`Config already exists: ${file}. Use --force to overwrite.`);
    process.exit(1);
  }

  const parsedPairs = parsePairsList(options.pairs);
  const parsedPools = parsePoolsList(options.pools);
  const timeframes = options.allTimeframes === true
    ? ALL_SUPPORTED_TIMEFRAMES
    : parseSimpleTimeframes(options.timeframes);
  const rpc = options.rpc !== undefined
    ? options.rpc
    : `env:${options.rpcEnv ?? preset.defaultRpcUrlEnv}`;

  const from = options.from ?? "2024-01-01";
  const to = options.to ?? "2024-01-02";
  const pair = options.pair ?? "WETH/USDC";

  const baseConfig = {
    chain,
    rpc,
    from,
    to,
    datasetId: options.datasetId ?? inferSimpleDatasetId({
      chain,
      pair,
      pool: options.pool,
      from,
      to,
    }),
    ...(options.baseTimeframe !== undefined ? { baseTimeframe: options.baseTimeframe } : {}),
    ...(timeframes !== undefined ? { timeframes } : {}),
    ...(options.out !== undefined ? { out: options.out } : {}),
  };

  const config = parsedPools !== undefined && parsedPools.length > 0
    ? {
        ...baseConfig,
        pools: parsedPools,
      }
    : options.pool !== undefined
      ? {
          ...baseConfig,
          pool: options.pool,
          ...(options.base !== undefined ? { base: options.base } : {}),
          ...(options.quote !== undefined ? { quote: options.quote } : {}),
        }
      : parsedPairs !== undefined && parsedPairs.length > 0
        ? {
            ...baseConfig,
            pairs: parsedPairs,
          }
        : {
            ...baseConfig,
            pair,
            fee: Number(options.fee ?? 500),
            ...(options.base !== undefined ? { base: options.base } : {}),
            ...(options.quote !== undefined ? { quote: options.quote } : {}),
          };

  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  printLine(`Created ${file}`);
  printLine("");
  printLine("Config files are optional. For the direct CLI flow you can usually run:");
  printLine(`  dex-pool build ${chain}:${pair} --fee ${options.fee ?? 500} --from ${from} --to ${to}`);
  printLine("");
  printLine("Or build from this config:");
  if (options.rpc === undefined) {
    printLine(`  export ${options.rpcEnv ?? preset.defaultRpcUrlEnv}="https://your-archive-rpc"`);
  }
  printLine(`  dex-pool build --config ${file}`);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create an optional dex-pool config file. Direct CLI flags are preferred for one-off builds.")
    .option("--file <file>", "Config file to create")
    .option("--chain <chain>", "Chain, default base")
    .option("--pool <pool>", "Pool contract address")
    .option("--pools <pools>", "Comma-separated pool contract addresses")
    .option("--pair <pair>", "Pair selector, default WETH/USDC")
    .option("--pairs <pairs>", "Comma-separated pair selectors, e.g. WETH/USDC,cbBTC/WETH:3000")
    .option("--fee <fee>", "Fee tier, default 500")
    .option("--from <from>", "From date")
    .option("--to <to>", "Exclusive to date")
    .option("--rpc <rpc>", "Direct RPC URL")
    .option("--rpc-env <rpcEnv>", "RPC environment variable name")
    .option("--out <out>", "Output path or URI")
    .option("--base <base>", "Base token selector, only used with --pool/--pair")
    .option("--quote <quote>", "Quote token selector, only used with --pool/--pair")
    .option("--timeframes <timeframes>", "Comma-separated timeframes")
    .option("--all-timeframes", "Use all supported timeframes: 1m,3m,5m,15m,30m,1h,4h,1d")
    .option("--base-timeframe <baseTimeframe>", "Base timeframe")
    .option("--dataset-id <datasetId>", "Dataset ID override")
    .option("--force", "Overwrite existing config")
    .action(async (opts: InitCommandOptions) => {
      await runInitCommand(opts);
    });
}
