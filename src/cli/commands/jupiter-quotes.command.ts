import type { Command } from "commander";
import {
  runJupiterQuoteSampler,
  type JupiterQuoteSampleSeed,
} from "../../jupiter/jupiter-quote-sampler.js";
import { printError, printJson, printLine } from "../cli-output.js";

type JupiterQuotesCommandOptions = {
  pair?: string[];
  datasetId?: string;
  out?: string;
  output?: string;
  intervalSeconds?: string;
  durationSeconds?: string;
  json?: boolean;
  verbose?: boolean;
};

export async function runJupiterQuotesCommand(
  options: JupiterQuotesCommandOptions,
): Promise<void> {
  try {
    const seeds = parseSeeds(options.pair);
    if (seeds.length === 0) {
      throw new Error(
        "JUPITER_QUOTES_PAIR_REQUIRED: pass at least one --pair <inputMint>:<outputMint>:<amount>",
      );
    }

    const datasetId = options.datasetId ?? `jupiter-quote-snapshots-${Date.now()}`;
    const outputUri = normalizeOutputUri(
      options.out ?? options.output ?? `./data/jupiter-quote-snapshots/${datasetId}`,
    );

    const result = await runJupiterQuoteSampler({
      datasetId,
      outputUri,
      seeds,
      intervalSeconds: options.intervalSeconds !== undefined ? Number(options.intervalSeconds) : undefined,
      durationSeconds: options.durationSeconds !== undefined ? Number(options.durationSeconds) : undefined,
      onSample:
        options.verbose === true && options.json !== true
          ? (event) => printLine(`Iteration ${event.iteration + 1}: sampled ${event.records.length} quote(s)`)
          : undefined,
    });

    if (options.json === true) {
      printJson(result);
    } else {
      printLine(`Jupiter quote snapshot dataset built: ${result.sampleCount} sample(s)`);
      printLine(`Dataset: ${datasetId}`);
      printLine(`Output: ${outputUri}`);
      printLine("Note: forward-only snapshots, not a historical dataset.");
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json === true) {
      printJson({ error: message });
    } else {
      printError(`Jupiter quote sampling failed: ${message}`);
    }
    process.exit(1);
  }
}

function parseSeeds(pairs: string[] | undefined): JupiterQuoteSampleSeed[] {
  return (pairs ?? []).map((pair) => {
    const [inputMint, outputMint, amount] = pair.split(":");
    if (inputMint === undefined || outputMint === undefined || amount === undefined) {
      throw new Error(`JUPITER_QUOTES_PAIR_INVALID:${pair}`);
    }
    return { inputMint, outputMint, amount };
  });
}

function normalizeOutputUri(uri: string): string {
  if (uri.startsWith("local://") || uri.startsWith("s3://")) return uri;
  return `local://${uri}`;
}

function collectPair(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerJupiterQuotesCommand(program: Command): void {
  program
    .command("jupiter-quotes")
    .description(
      "Sample Jupiter quote snapshots for one or more mint pairs (datasetType JUPITER_QUOTE_SNAPSHOT — forward-only, not historical)",
    )
    .option(
      "--pair <inputMint:outputMint:amount>",
      "Mint pair + raw input amount to sample, e.g. So111...112:EPjF...v1:1000000000 (repeatable)",
      collectPair,
      [],
    )
    .option("--dataset-id <datasetId>", "Dataset ID override")
    .option("--out <out>", "Output path or URI")
    .option("--output <output>", "Output URI override, local:// or s3://")
    .option("--interval-seconds <intervalSeconds>", "Seconds between samples (omit for a single sample)")
    .option("--duration-seconds <durationSeconds>", "Total seconds to keep sampling (used with --interval-seconds)")
    .option("--json", "Output result as JSON")
    .option("--verbose", "Verbose output")
    .action(async (opts: JupiterQuotesCommandOptions) => {
      await runJupiterQuotesCommand(opts);
    });
}
