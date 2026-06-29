import type {
  DexChain,
  DexPoolToken,
} from "../types/dex-pool-dataset.types.js";

export type SimpleTokenPreset = DexPoolToken;

export const TOKEN_PRESETS: Partial<
  Record<DexChain, Record<string, SimpleTokenPreset>>
> = {
  base: {
    WETH: {
      symbol: "WETH",
      address: "0x4200000000000000000000000000000000000006",
      decimals: 18,
    },

    USDC: {
      symbol: "USDC",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
    },

    CBBTC: {
      symbol: "cbBTC",
      address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      decimals: 8,
    },

    CBETH: {
      symbol: "cbETH",
      address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
      decimals: 18,
    },

    AERO: {
      symbol: "AERO",
      address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
      decimals: 18,
    },
  },
};

export function resolveTokenPreset(input: {
  chain: DexChain;
  selector: string;
}): SimpleTokenPreset {
  const chainTokens = TOKEN_PRESETS[input.chain];

  if (chainTokens === undefined) {
    throw new Error(`SIMPLE_TOKEN_PRESETS_UNSUPPORTED_CHAIN:${input.chain}`);
  }

  const normalized = input.selector.toUpperCase();
  const token = chainTokens[normalized];

  if (token === undefined) {
    throw new Error(
      `SIMPLE_TOKEN_PRESET_NOT_FOUND:${input.chain}:${normalized}`,
    );
  }

  return token;
}
