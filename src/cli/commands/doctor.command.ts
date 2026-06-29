import type { Command } from "commander";
import { createEvmJsonRpcClient } from "../../evm/evm-json-rpc-client.js";
import { getSimpleChainPreset } from "../../simple/chain-presets.js";
import { readUniswapV3PoolConfig } from "../../simple/evm-contract-reader.js";
import { resolvePoolSelection } from "../../simple/resolve-pool-selection.js";
import { resolveSimpleRpcUrl } from "../../simple/resolve-simple-build-config.js";
import { printJson, printLine } from "../cli-output.js";

type DoctorCommandOptions = {
  chain: string;
  rpc?: string;
  rpcEnv?: string;
  pool?: string;
  pair?: string;
  fee?: string;
  token0?: string;
  token1?: string;
  json?: boolean;
};

export async function runDoctorCommand(
  options: DoctorCommandOptions,
): Promise<void> {
  const checks: Array<{
    name: string;
    ok: boolean;
    detail?: string;
  }> = [];

  try {
    const preset = getSimpleChainPreset(options.chain);

    const rpcUrl = resolveSimpleRpcUrl({
      chain: options.chain,
      rpcUrl: options.rpc,
      rpcUrlEnv: options.rpcEnv,
    });

    checks.push({
      name: "rpc",
      ok: true,
      detail: options.rpcEnv ?? preset.defaultRpcUrlEnv,
    });

    const client = createEvmJsonRpcClient({ rpcUrl });
    const chainId = await client.getChainId();

    checks.push({
      name: "chainId",
      ok: chainId === BigInt(preset.chainId),
      detail: `expected=${preset.chainId} actual=${chainId.toString()}`,
    });

    const latestBlock = await client.getLatestBlockNumber();

    checks.push({
      name: "latestBlock",
      ok: latestBlock > 0n,
      detail: latestBlock.toString(),
    });

    const hasPoolSelection =
      options.pool !== undefined ||
      options.pair !== undefined ||
      options.token0 !== undefined ||
      options.token1 !== undefined;

    if (hasPoolSelection) {
      const poolSelection = await resolvePoolSelection({
        client,
        chain: preset.chain,
        pool: options.pool,
        pair: options.pair,
        fee: options.fee,
        token0: options.token0,
        token1: options.token1,
      });

      const pool = await readUniswapV3PoolConfig({
        client,
        chain: preset.chain,
        poolAddress: poolSelection.poolAddress,
        startBlock: "0",
        base: poolSelection.base,
        quote: poolSelection.quote,
      });

      checks.push({
        name: "pool",
        ok: true,
        detail: `${pool[pool.baseToken].symbol}/${pool[pool.quoteToken].symbol} fee=${pool.feeTier}`,
      });
    }
  } catch (error: unknown) {
    checks.push({
      name: "fatal",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  if (options.json === true) {
    printJson({
      ok: checks.every((check) => check.ok),
      checks,
    });
  } else {
    for (const check of checks) {
      printLine(
        `${check.ok ? "✓" : "✗"} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`,
      );
    }
  }

  process.exit(checks.every((check) => check.ok) ? 0 : 1);
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description(
      "Check RPC, chain ID, latest block, and optionally pool/pair metadata",
    )
    .requiredOption("--chain <chain>", "Chain, e.g. base")
    .option("--rpc <url>", "Direct RPC URL")
    .option("--rpc-env <env>", "RPC environment variable name")
    .option("--pool <address>", "Optional pool contract address")
    .option("--pair <pair>", "Optional pair selector, e.g. WETH/USDC")
    .option("--fee <fee>", "Optional Uniswap v3 fee tier, e.g. 500")
    .option("--token0 <address>", "Optional token address for factory.getPool")
    .option("--token1 <address>", "Optional token address for factory.getPool")
    .option("--json", "Output JSON")
    .action(async (opts: DoctorCommandOptions) => {
      await runDoctorCommand(opts);
    });
}
