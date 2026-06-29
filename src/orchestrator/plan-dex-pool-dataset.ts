import type { ResolvedDexBuildConfig } from "../config/dex-build-config.types.js";

export type DexBuildPlan = {
  datasetId: string;
  profile?: string;
  outputUri: string;
  rpcEnvPresent: boolean;
  pools: Array<{
    poolId: string;
    fromBlock: string;
    toBlock: string;
    baseTimeframe: string;
    timeframes: string[];
    chunkSize: string;
  }>;
};

export function planDexPoolDataset(
  config: ResolvedDexBuildConfig,
): DexBuildPlan {
  return {
    datasetId: config.datasetId,
    profile: config.profile,
    outputUri: config.output.uri,
    rpcEnvPresent: config.network.rpcUrl.length > 0,
    pools: config.build.pools.map((poolId) => ({
      poolId,
      fromBlock: config.build.fromBlock.toString(),
      toBlock: config.build.toBlock.toString(),
      baseTimeframe: config.build.baseTimeframe,
      timeframes: config.build.timeframes,
      chunkSize: config.build.chunkSize.toString(),
    })),
  };
}
