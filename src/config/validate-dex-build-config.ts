import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import type { DexBuildConfig } from "./dex-build-config.types.js";
import { validatePoolRegistry } from "../registry/pool-registry.js";
import { ALL_TIMEFRAMES } from "../contracts/timeframe.js";

export type ValidateDexBuildConfigOptions = {
  config: DexBuildConfig;
  profile?: string;
};

export type DexBuildConfigValidationResult = {
  valid: boolean;
  errors: string[];
};

function isBigIntString(value: string): boolean {
  try {
    BigInt(value);
    return true;
  } catch {
    return false;
  }
}

function isPositiveBigIntString(value: string): boolean {
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

export async function validateDexBuildConfig(
  options: ValidateDexBuildConfigOptions,
): Promise<DexBuildConfigValidationResult> {
  const { config, profile } = options;
  const errors: string[] = [];

  // Schema field validation
  if (typeof config.datasetId !== "string" || config.datasetId.length === 0) {
    errors.push("INVALID_FIELD:datasetId must be a non-empty string");
  }

  if (
    typeof config.registry?.path !== "string" ||
    config.registry.path.length === 0
  ) {
    errors.push("INVALID_FIELD:registry.path must be a non-empty string");
  }

  if (
    typeof config.network?.chain !== "string" ||
    config.network.chain.length === 0
  ) {
    errors.push("INVALID_FIELD:network.chain must be a non-empty string");
  }

  if (
    typeof config.network?.chainId !== "number" ||
    !Number.isInteger(config.network.chainId)
  ) {
    errors.push("INVALID_FIELD:network.chainId must be an integer");
  }

  if (
    typeof config.network?.rpcUrlEnv !== "string" ||
    config.network.rpcUrlEnv.length === 0
  ) {
    errors.push("INVALID_FIELD:network.rpcUrlEnv must be a non-empty string");
  }

  if (!Array.isArray(config.build?.pools) || config.build.pools.length === 0) {
    errors.push("INVALID_FIELD:build.pools must be a non-empty array");
  }

  if (
    typeof config.build?.fromBlock !== "string" ||
    !isBigIntString(config.build.fromBlock)
  ) {
    errors.push("INVALID_FIELD:build.fromBlock must be a valid integer string");
  }

  if (
    typeof config.build?.toBlock !== "string" ||
    !isBigIntString(config.build.toBlock)
  ) {
    errors.push("INVALID_FIELD:build.toBlock must be a valid integer string");
  }

  if (
    typeof config.build?.fromBlock === "string" &&
    typeof config.build?.toBlock === "string" &&
    isBigIntString(config.build.fromBlock) &&
    isBigIntString(config.build.toBlock) &&
    BigInt(config.build.fromBlock) >= BigInt(config.build.toBlock)
  ) {
    errors.push(
      "INVALID_RANGE:build.fromBlock must be less than build.toBlock",
    );
  }

  if (!ALL_TIMEFRAMES.includes(config.build?.baseTimeframe)) {
    errors.push(
      `INVALID_FIELD:build.baseTimeframe must be one of ${ALL_TIMEFRAMES.join(", ")}`,
    );
  }

  if (
    !Array.isArray(config.build?.timeframes) ||
    config.build.timeframes.length === 0
  ) {
    errors.push("INVALID_FIELD:build.timeframes must be a non-empty array");
  } else if (!config.build.timeframes.includes(config.build?.baseTimeframe)) {
    errors.push(
      "INVALID_FIELD:build.timeframes must include build.baseTimeframe",
    );
  }

  if (
    config.build?.chunkSize !== undefined &&
    (!isBigIntString(config.build.chunkSize) ||
      !isPositiveBigIntString(config.build.chunkSize))
  ) {
    errors.push(
      "INVALID_FIELD:build.chunkSize must be a valid positive integer string",
    );
  }

  if (config.output?.type !== "local" && config.output?.type !== "s3") {
    errors.push('INVALID_FIELD:output.type must be "local" or "s3"');
  }

  if (
    typeof config.output?.uri !== "string" ||
    config.output.uri.length === 0
  ) {
    errors.push("INVALID_FIELD:output.uri must be a non-empty string");
  } else if (config.output.type === "s3") {
    const s3Match = config.output.uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (!s3Match) {
      errors.push(
        "INVALID_FIELD:output.uri must be a valid s3:// URI with bucket and prefix (e.g. s3://bucket/prefix)",
      );
    }
  }

  // Profile validation
  if (profile !== undefined) {
    if (config.profiles === undefined || !(profile in config.profiles)) {
      errors.push(`UNKNOWN_PROFILE:${profile}`);
    }
  }

  // Env var presence
  const rpcUrlEnv = config.network?.rpcUrlEnv;
  if (typeof rpcUrlEnv === "string" && rpcUrlEnv.length > 0) {
    if (!process.env[rpcUrlEnv]) {
      errors.push(`RPC_ENV_MISSING:${rpcUrlEnv}`);
    }
  }

  // Registry file existence
  const registryPath = config.registry?.path;
  if (typeof registryPath === "string" && registryPath.length > 0) {
    try {
      await access(registryPath);

      // Registry is readable — validate pool IDs
      if (Array.isArray(config.build?.pools) && config.build.pools.length > 0) {
        try {
          const raw = await readFile(registryPath, "utf8");
          const parsed: unknown = JSON.parse(raw);
          const result = validatePoolRegistry(parsed);
          if (result.errors.length > 0) {
            for (const err of result.errors) {
              errors.push(`REGISTRY_ERROR:${err}`);
            }
          } else {
            const registryIds = new Set(result.pools.map((p) => p.id));
            for (const poolId of config.build.pools) {
              if (!registryIds.has(poolId)) {
                errors.push(`POOL_NOT_FOUND:${poolId}`);
              }
            }
          }
        } catch {
          errors.push(`REGISTRY_PARSE_ERROR:${registryPath}`);
        }
      }
    } catch {
      errors.push(`REGISTRY_NOT_FOUND:${registryPath}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
