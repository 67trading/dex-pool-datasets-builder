import type { Command } from "commander";
import { createEvmJsonRpcClient } from "../../evm/evm-json-rpc-client.js";
import { getSimpleChainPreset } from "../../simple/chain-presets.js";
import { readUniswapV3PoolConfig } from "../../simple/evm-contract-reader.js";
import { resolvePoolSelection } from "../../simple/resolve-pool-selection.js";
import { resolveSimpleRpcUrl } from "../../simple/resolve-simple-build-config.js";
import { printError, printJson, printLine } from "../cli-output.js";

type InspectCommandOptions = {
  chain: string;
  pool?: string;
  pair?: string;
  fee?: string;
  token0?: string;
  token1?: string;
  rpc?: string;
  rpcEnv?: string;
  base?: string;
  quote?: string;
  json?: boolean;
};

export async function runInspectCommand(
  options: InspectCommandOptions,
): Promise<void> {
  try {
    const preset = getSimpleChainPreset(options.chain);

    const rpcUrl = resolveSimpleRpcUrl({
      chain: options.chain,
      rpcUrl: options.rpc,
      rpcUrlEnv: options.rpcEnv,
    });

    const client = createEvmJsonRpcClient({ rpcUrl });

    const poolSelection = await resolvePoolSelection({
      client,
      chain: preset.chain,
      pool: options.pool,
      pair: options.pair,
      fee: options.fee,
      token0: options.token0,
      token1: options.token1,
      base: options.base,
      quote: options.quote,
    });

    const pool = await readUniswapV3PoolConfig({
      client,
      chain: preset.chain,
      poolAddress: poolSelection.poolAddress,
      startBlock: "0",
      base: poolSelection.base ?? options.base,
      quote: poolSelection.quote ?? options.quote,
    });

    if (options.json === true) {
      printJson({
        selection: poolSelection,
        pool,
      });
      return;
    }

    printLine(`Pool: ${pool.poolAddress}`);
    printLine(`Resolved by: ${poolSelection.resolvedBy}`);
    printLine(`Chain: ${pool.chain}`);
    printLine(`DEX: ${pool.dex}`);
    printLine(`Kind: ${pool.kind}`);
    printLine(`Fee tier: ${pool.feeTier ?? "(unknown)"}`);
    printLine(`Generated ID: ${pool.id}`);
    printLine("");
    printLine(
      `token0: ${pool.token0.symbol} ${pool.token0.address} decimals=${pool.token0.decimals}`,
    );
    printLine(
      `token1: ${pool.token1.symbol} ${pool.token1.address} decimals=${pool.token1.decimals}`,
    );
    printLine(
      `base/quote: ${pool[pool.baseToken].symbol}/${pool[pool.quoteToken].symbol}`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (options.json === true) {
      printJson({
        ok: false,
        error: message,
      });
    } else {
      printError(`Inspect failed: ${message}`);
    }

    process.exit(1);
  }
}

export function registerInspectCommand(program: Command): void {
  program
    .command("inspect")
    .description("Inspect a Uniswap v3-style pool by pool address or pair/fee")
    .requiredOption("--chain <chain>", "Chain, e.g. base")
    .option("--pool <address>", "Pool contract address")
    .option("--pair <pair>", "Pair selector, e.g. WETH/USDC")
    .option("--fee <fee>", "Uniswap v3 fee tier, e.g. 500")
    .option("--token0 <address>", "Token address for factory.getPool")
    .option("--token1 <address>", "Token address for factory.getPool")
    .option("--rpc <url>", "Direct RPC URL")
    .option("--rpc-env <env>", "RPC environment variable name")
    .option("--base <symbolOrAddress>", "Base token selector")
    .option("--quote <symbolOrAddress>", "Quote token selector")
    .option("--json", "Output JSON")
    .action(async (opts: InspectCommandOptions) => {
      await runInspectCommand(opts);
    });
}
