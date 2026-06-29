import type { DexChain } from "../types/dex-pool-dataset.types.js";

export type SimpleChainPreset = {
  chain: DexChain;
  chainId: number;
  defaultRpcUrlEnv: string;
  finalityConfirmations: number;
};

export const SIMPLE_CHAIN_PRESETS: Record<DexChain, SimpleChainPreset> = {
  ethereum: {
    chain: "ethereum",
    chainId: 1,
    defaultRpcUrlEnv: "ETH_RPC_URL",
    finalityConfirmations: 64,
  },

  base: {
    chain: "base",
    chainId: 8453,
    defaultRpcUrlEnv: "BASE_RPC_URL",
    finalityConfirmations: 64,
  },

  arbitrum: {
    chain: "arbitrum",
    chainId: 42161,
    defaultRpcUrlEnv: "ARBITRUM_RPC_URL",
    finalityConfirmations: 64,
  },

  polygon: {
    chain: "polygon",
    chainId: 137,
    defaultRpcUrlEnv: "POLYGON_RPC_URL",
    finalityConfirmations: 128,
  },

  bsc: {
    chain: "bsc",
    chainId: 56,
    defaultRpcUrlEnv: "BSC_RPC_URL",
    finalityConfirmations: 64,
  },
};

export function getSimpleChainPreset(chain: string): SimpleChainPreset {
  const preset = SIMPLE_CHAIN_PRESETS[chain as DexChain];

  if (preset === undefined) {
    throw new Error(`SIMPLE_CHAIN_UNSUPPORTED:${chain}`);
  }

  return preset;
}
