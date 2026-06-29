import type { DexChain } from "../types/dex-pool-dataset.types.js";
import type { HexString } from "../evm/evm-json-rpc-client.js";

export type UniswapV3FactoryPreset = {
  factoryAddress: HexString;
  deploymentBlock: bigint;
};

export const UNISWAP_V3_FACTORY_PRESETS: Partial<
  Record<DexChain, UniswapV3FactoryPreset>
> = {
  ethereum: {
    factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    deploymentBlock: 12_369_621n,
  },

  base: {
    factoryAddress: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    deploymentBlock: 1_371_680n,
  },

  arbitrum: {
    factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    deploymentBlock: 165n,
  },

  polygon: {
    factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    deploymentBlock: 22_757_547n,
  },
};

export function getUniswapV3FactoryPreset(
  chain: DexChain,
): UniswapV3FactoryPreset {
  const preset = UNISWAP_V3_FACTORY_PRESETS[chain];

  if (preset === undefined) {
    throw new Error(`SIMPLE_FACTORY_UNSUPPORTED_CHAIN:${chain}`);
  }

  return preset;
}

export function getUniswapV3FactoryAddress(chain: DexChain): HexString {
  return getUniswapV3FactoryPreset(chain).factoryAddress;
}
