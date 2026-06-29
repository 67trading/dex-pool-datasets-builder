import type {
  DexBuildConfig,
  ResolvedDexBuildConfig,
} from "./dex-build-config.types.js";

export type ResolveDexBuildConfigOptions = {
  config: DexBuildConfig;
  profile?: string;
  outputOverride?: string;
};

export function resolveDexBuildConfig(
  options: ResolveDexBuildConfigOptions,
): ResolvedDexBuildConfig {
  const { config, profile, outputOverride } = options;

  // Merge profile if specified
  let mergedOutput = config.output;
  let mergedBuild = config.build;

  if (profile !== undefined) {
    const profileConfig = config.profiles?.[profile];
    if (profileConfig === undefined) {
      throw new Error(`CONFIG_UNKNOWN_PROFILE:${profile}`);
    }
    if (profileConfig.output !== undefined) {
      mergedOutput = { ...mergedOutput, ...profileConfig.output };
    }
    if (profileConfig.build !== undefined) {
      mergedBuild = { ...mergedBuild, ...profileConfig.build };
    }
  }

  // Apply output override from CLI
  if (outputOverride !== undefined) {
    mergedOutput = {
      ...mergedOutput,
      uri: outputOverride,
      type: outputOverride.startsWith("s3://") ? "s3" : "local",
    };
  }

  // Resolve RPC URL from env
  const rpcUrl = process.env[config.network.rpcUrlEnv];
  if (!rpcUrl) {
    throw new Error(`CONFIG_RPC_ENV_MISSING:${config.network.rpcUrlEnv}`);
  }

  return {
    datasetId: config.datasetId,
    registryPath: config.registry.path,
    registryPools: [],
    network: {
      chain: config.network.chain,
      chainId: config.network.chainId,
      rpcUrl,
      finality: config.network.finality,
    },
    build: {
      pools: mergedBuild.pools,
      fromBlock: BigInt(mergedBuild.fromBlock),
      toBlock: BigInt(mergedBuild.toBlock),
      baseTimeframe: mergedBuild.baseTimeframe,
      timeframes: mergedBuild.timeframes,
      chunkSize: BigInt(mergedBuild.chunkSize ?? "5000"),
      failFast: mergedBuild.failFast ?? true,
    },
    output: mergedOutput,
    profile,
  };
}
