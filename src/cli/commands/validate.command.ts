import type { Command } from "commander";
import { loadDexBuildConfig } from "../../config/load-dex-build-config.js";
import { validateDexBuildConfig } from "../../config/validate-dex-build-config.js";
import { printLine, printError, printJson } from "../cli-output.js";

type ValidateCommandOptions = {
  config: string;
  profile?: string;
  json?: boolean;
};

export async function runValidateCommand(
  options: ValidateCommandOptions,
): Promise<void> {
  const { config: configPath, profile, json } = options;

  const config = await loadDexBuildConfig(configPath).catch(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (json === true) {
        printJson({ valid: false, errors: [message] });
      } else {
        printError(`Error loading config: ${message}`);
      }
      process.exit(1);
    },
  );

  const result = await validateDexBuildConfig({ config, profile });

  if (json === true) {
    printJson(result);
    process.exit(result.valid ? 0 : 1);
    return;
  }

  printLine(`Validating: ${configPath}`);

  const rpcEnv = config.network?.rpcUrlEnv ?? "(unknown)";
  const registryPath = config.registry?.path ?? "(unknown)";
  const pools = config.build?.pools ?? [];

  // Check individual aspects and report status
  const schemaErrors = result.errors.filter(
    (e) =>
      e.startsWith("INVALID_FIELD:") ||
      e.startsWith("INVALID_RANGE:") ||
      e.startsWith("UNKNOWN_PROFILE:"),
  );
  const rpcErrors = result.errors.filter((e) =>
    e.startsWith("RPC_ENV_MISSING:"),
  );
  const registryErrors = result.errors.filter(
    (e) =>
      e.startsWith("REGISTRY_NOT_FOUND:") ||
      e.startsWith("REGISTRY_PARSE_ERROR:") ||
      e.startsWith("REGISTRY_ERROR:"),
  );
  const poolErrors = result.errors.filter((e) =>
    e.startsWith("POOL_NOT_FOUND:"),
  );

  if (schemaErrors.length === 0) {
    printLine("  ✓ Config schema");
  } else {
    for (const err of schemaErrors) {
      printLine(`  ✗ ${err}`);
    }
  }

  if (registryErrors.length === 0) {
    printLine(`  ✓ Registry: ${registryPath}`);
  } else {
    for (const err of registryErrors) {
      printLine(`  ✗ ${err}`);
    }
  }

  if (poolErrors.length === 0 && pools.length > 0) {
    printLine(`  ✓ Pools: ${pools.join(", ")}`);
  } else {
    for (const err of poolErrors) {
      const poolId = err.replace("POOL_NOT_FOUND:", "");
      printLine(`  ✗ Pool not found: ${poolId}`);
    }
  }

  if (rpcErrors.length === 0) {
    printLine(`  ✓ RPC env: ${rpcEnv}`);
  } else {
    for (const err of rpcErrors) {
      const envName = err.replace("RPC_ENV_MISSING:", "");
      printLine(`  ✗ RPC env: ${envName} not set`);
    }
  }

  const outputUri = config.output?.uri ?? "(unknown)";
  printLine(`  ✓ Output: ${outputUri}`);

  printLine("");
  if (result.valid) {
    printLine("Config valid.");
  } else {
    printLine(
      `Config invalid (${result.errors.length} error${result.errors.length === 1 ? "" : "s"}).`,
    );
  }

  process.exit(result.valid ? 0 : 1);
}

export function registerValidateCommand(program: Command): void {
  program
    .command("validate")
    .description("Validate a dex-pool-datasets config file")
    .requiredOption("-c, --config <path>", "Path to config file")
    .option("--profile <name>", "Profile to validate against")
    .option("--json", "Output results as JSON")
    .action(async (options: ValidateCommandOptions) => {
      await runValidateCommand(options);
    });
}
