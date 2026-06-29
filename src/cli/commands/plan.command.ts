import type { Command } from "commander";
import { loadDexBuildConfig } from "../../config/load-dex-build-config.js";
import { resolveDexBuildConfig } from "../../config/resolve-dex-build-config.js";
import type { ResolvedDexBuildConfig } from "../../config/dex-build-config.types.js";
import { printLine, printError, printJson } from "../cli-output.js";

type PlanCommandOptions = {
  config: string;
  profile?: string;
  pool?: string;
  json?: boolean;
};

export type PlanOutput = {
  datasetId: string;
  profile?: string;
  network: {
    chain: string;
    chainId: number;
    rpcEnvPresent: boolean;
    rpcUrlEnv: string;
  };
  output: {
    type: string;
    uri: string;
  };
  pools: Array<{
    id: string;
    fromBlock: string;
    toBlock: string;
    baseTimeframe: string;
    outputTimeframes: string[];
    chunkSize: string;
  }>;
  willWrite: false;
};

export function buildPlanOutput(
  resolved: ResolvedDexBuildConfig,
  rpcUrlEnv: string,
  filteredPools: string[],
): PlanOutput {
  return {
    datasetId: resolved.datasetId,
    profile: resolved.profile,
    network: {
      chain: resolved.network.chain,
      chainId: resolved.network.chainId,
      rpcUrlEnv,
      rpcEnvPresent: true,
    },
    output: {
      type: resolved.output.type,
      uri: resolved.output.uri,
    },
    pools: filteredPools.map((poolId) => ({
      id: poolId,
      fromBlock: resolved.build.fromBlock.toString(),
      toBlock: resolved.build.toBlock.toString(),
      baseTimeframe: resolved.build.baseTimeframe,
      outputTimeframes: resolved.build.timeframes,
      chunkSize: resolved.build.chunkSize.toString(),
    })),
    willWrite: false,
  };
}

export async function runPlanCommand(
  options: PlanCommandOptions,
): Promise<void> {
  const { config: configPath, profile, pool: poolFilter, json } = options;

  const rawConfig = await loadDexBuildConfig(configPath).catch(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (json === true) {
        printJson({ error: message });
      } else {
        printError(`Error loading config: ${message}`);
      }
      process.exit(1);
    },
  );

  const resolved = await Promise.resolve(
    resolveDexBuildConfig({ config: rawConfig, profile }),
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (json === true) {
      printJson({ error: message });
    } else {
      printError(`Error resolving config: ${message}`);
    }
    process.exit(1);
  });

  const filteredPools =
    poolFilter !== undefined
      ? resolved.build.pools.filter((id) => id === poolFilter)
      : resolved.build.pools;

  const rpcUrlEnv = rawConfig.network.rpcUrlEnv;

  if (json === true) {
    printJson(buildPlanOutput(resolved, rpcUrlEnv, filteredPools));
    return;
  }

  printLine(`Dataset: ${resolved.datasetId}`);
  if (resolved.profile !== undefined) {
    printLine(`Profile: ${resolved.profile}`);
  }
  printLine(
    `Network: ${resolved.network.chain} / chainId ${resolved.network.chainId}`,
  );
  printLine(`RPC: env ${rpcUrlEnv} present`);
  printLine(`Output: ${resolved.output.uri}`);
  printLine("");
  printLine("Pools:");

  for (const poolId of filteredPools) {
    printLine(`  - ${poolId}`);
    printLine(`    symbol: (not resolved — registry not read)`);
    printLine(`    fromBlock: ${resolved.build.fromBlock.toString()}`);
    printLine(`    toBlock: ${resolved.build.toBlock.toString()}`);
    printLine(`    baseTimeframe: ${resolved.build.baseTimeframe}`);
    printLine(`    outputTimeframes: ${resolved.build.timeframes.join(", ")}`);
    printLine(`    chunkSize: ${resolved.build.chunkSize.toString()}`);
  }

  printLine("");
  printLine("No dataset objects will be written.");
}

export function registerPlanCommand(program: Command): void {
  program
    .command("plan")
    .description("Show the build plan without making any RPC calls or writes")
    .requiredOption("-c, --config <path>", "Path to config file")
    .option("--profile <name>", "Profile to apply")
    .option("--pool <id>", "Filter to a single pool")
    .option("--json", "Output plan as JSON")
    .action(async (options: PlanCommandOptions) => {
      await runPlanCommand(options);
    });
}
