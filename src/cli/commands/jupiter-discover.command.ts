import type { Command } from "commander";
import { discoverSolanaPoolsViaJupiter } from "../../jupiter/jupiter-pool-discovery.js";
import { printError, printJson, printLine } from "../cli-output.js";

type JupiterDiscoverCommandOptions = {
  input?: string;
  output?: string;
  amounts?: string;
  symbols?: string;
  excludeDexes?: string;
  rpc?: string;
  rpcEnv?: string;
  json?: boolean;
};

export async function runJupiterDiscoverCommand(
  options: JupiterDiscoverCommandOptions,
): Promise<void> {
  try {
    if (options.input === undefined || options.output === undefined) {
      throw new Error("JUPITER_DISCOVER_MINTS_REQUIRED: pass --input and --output mint addresses");
    }

    const amounts = (options.amounts ?? "1000000000")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const mintSymbols = parseSymbolsOption(options.symbols);
    const excludeDexes = options.excludeDexes
      ?.split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const rpcUrl = resolveRpcUrl(options);

    const result = await discoverSolanaPoolsViaJupiter({
      seeds: [{ inputMint: options.input, outputMint: options.output, amounts }],
      solanaRpcUrl: rpcUrl,
      mintSymbols,
      excludeDexes,
    });

    if (options.json === true) {
      printJson(result);
      return;
    }

    printLine(`Discovered ${result.candidates.length} known-AMM pool candidate(s):`);
    for (const candidate of result.candidates) {
      printLine(
        ` - [${candidate.dex}] ${candidate.poolAddress} (${candidate.token0.symbol}/${candidate.token1.symbol})` +
          (candidate.jupiterLabel !== undefined ? ` — Jupiter label: ${candidate.jupiterLabel}` : ""),
      );
    }

    if (result.unrecognized.length > 0) {
      printLine("");
      printLine(
        `${result.unrecognized.length} route leg(s) used a program not in the known AMM registry (see src/solana/solana-amm-program-registry.ts):`,
      );
      for (const leg of result.unrecognized) {
        printLine(
          ` - ${leg.ammKey} owned by ${leg.ownerProgramId}` +
            (leg.jupiterLabel !== undefined ? ` (Jupiter label: ${leg.jupiterLabel})` : ""),
        );
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json === true) {
      printJson({ error: message });
    } else {
      printError(`Jupiter discovery failed: ${message}`);
    }
    process.exit(1);
  }
}

function resolveRpcUrl(options: JupiterDiscoverCommandOptions): string {
  if (options.rpc !== undefined) return options.rpc;
  const envName = options.rpcEnv ?? "SOLANA_RPC_URL";
  const value = process.env[envName];
  if (value === undefined || value.length === 0) {
    throw new Error(`JUPITER_DISCOVER_RPC_ENV_MISSING:${envName}`);
  }
  return value;
}

function parseSymbolsOption(value: string | undefined): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const entries = value
    .split(",")
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const [symbol, mint] = pair.split("=");
      if (symbol === undefined || mint === undefined) {
        throw new Error(`JUPITER_DISCOVER_SYMBOLS_INVALID:${pair}`);
      }
      return [mint, symbol] as const;
    });
  return Object.fromEntries(entries);
}

export function registerJupiterDiscoverCommand(program: Command): void {
  program
    .command("jupiter-discover")
    .description(
      "Sample Jupiter quote routes for a mint pair and resolve route legs to known Solana AMM pools (discovery only — not a build-ready registry)",
    )
    .requiredOption("--input <mint>", "Input mint address")
    .requiredOption("--output <mint>", "Output mint address")
    .option("--amounts <amounts>", "Comma-separated raw input amounts to sample, e.g. 100000000,1000000000", "1000000000")
    .option("--symbols <symbols>", "Comma-separated symbol=mint pairs for readable output, e.g. SOL=So111...,USDC=EPjF...")
    .option("--exclude-dexes <dexes>", "Comma-separated Jupiter dex labels to exclude from routing")
    .option("--rpc <rpc>", "Direct Solana RPC URL")
    .option("--rpc-env <rpcEnv>", "Solana RPC environment variable name, default SOLANA_RPC_URL")
    .option("--json", "Output as JSON")
    .action(async (opts: JupiterDiscoverCommandOptions) => {
      await runJupiterDiscoverCommand(opts);
    });
}
