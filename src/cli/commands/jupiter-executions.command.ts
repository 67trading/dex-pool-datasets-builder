import type { Command } from "commander";
import { buildJupiterExecutionDataset } from "../../jupiter/build-jupiter-execution-dataset.js";
import { printError, printJson, printLine } from "../cli-output.js";

type JupiterExecutionsCommandOptions = {
  datasetId?: string;
  fromSlot?: string;
  toSlot?: string;
  out?: string;
  output?: string;
  rpc?: string;
  rpcEnv?: string;
  json?: boolean;
  verbose?: boolean;
};

export async function runJupiterExecutionsCommand(
  options: JupiterExecutionsCommandOptions,
): Promise<void> {
  try {
    if (options.fromSlot === undefined || options.toSlot === undefined) {
      throw new Error("JUPITER_EXECUTIONS_SLOT_RANGE_REQUIRED: pass --from-slot and --to-slot");
    }

    const rpcUrl = resolveRpcUrl(options);
    const datasetId = options.datasetId ?? `jupiter-executions-${options.fromSlot}-${options.toSlot}`;
    const outputUri = normalizeOutputUri(options.out ?? options.output ?? `./data/jupiter-executions/${datasetId}`);

    const result = await buildJupiterExecutionDataset({
      datasetId,
      rpcUrl,
      outputUri,
      fromSlot: BigInt(options.fromSlot),
      toSlot: BigInt(options.toSlot),
      onProgress:
        options.verbose === true && options.json !== true
          ? (event) => printLine(`Decoded executions: ${event.count}`)
          : undefined,
    });

    if (options.json === true) {
      printJson(result);
    } else {
      printLine(`Jupiter execution dataset built: ${result.recordCount} record(s)`);
      printLine(`Dataset: ${datasetId}`);
      printLine(`Output: ${outputUri}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json === true) {
      printJson({ error: message });
    } else {
      printError(`Jupiter executions build failed: ${message}`);
    }
    process.exit(1);
  }
}

function resolveRpcUrl(options: JupiterExecutionsCommandOptions): string {
  if (options.rpc !== undefined) return options.rpc;
  const envName = options.rpcEnv ?? "SOLANA_RPC_URL";
  const value = process.env[envName];
  if (value === undefined || value.length === 0) {
    throw new Error(`JUPITER_EXECUTIONS_RPC_ENV_MISSING:${envName}`);
  }
  return value;
}

function normalizeOutputUri(uri: string): string {
  if (uri.startsWith("local://") || uri.startsWith("s3://")) return uri;
  return `local://${uri}`;
}

export function registerJupiterExecutionsCommand(program: Command): void {
  program
    .command("jupiter-executions")
    .description(
      "Build a historical dataset of executed Jupiter-routed Solana swaps for a slot range (datasetType JUPITER_EXECUTION)",
    )
    .requiredOption("--from-slot <fromSlot>", "Starting Solana slot (inclusive)")
    .requiredOption("--to-slot <toSlot>", "Ending Solana slot (inclusive)")
    .option("--dataset-id <datasetId>", "Dataset ID override")
    .option("--out <out>", "Output path or URI")
    .option("--output <output>", "Output URI override, local:// or s3://")
    .option("--rpc <rpc>", "Direct Solana RPC URL")
    .option("--rpc-env <rpcEnv>", "Solana RPC environment variable name, default SOLANA_RPC_URL")
    .option("--json", "Output result as JSON")
    .option("--verbose", "Verbose output")
    .action(async (opts: JupiterExecutionsCommandOptions) => {
      await runJupiterExecutionsCommand(opts);
    });
}
