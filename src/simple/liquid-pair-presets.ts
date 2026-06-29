import type { DexChain } from "../types/dex-pool-dataset.types.js";

export type LiquidPairPreset = {
  pair: string;
  fee: number;
};

export const LIQUID_PAIR_PRESETS: Partial<
  Record<DexChain, Record<string, LiquidPairPreset>>
> = {
  base: {
    "WETH/USDC": {
      pair: "WETH/USDC",
      fee: 500,
    },
  },
};

export function normalizePair(pair: string): string {
  const parts = pair
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length !== 2) {
    throw new Error(`SIMPLE_PAIR_INVALID:${pair}`);
  }

  return `${parts[0]!.toUpperCase()}/${parts[1]!.toUpperCase()}`;
}

export function getLiquidPairPreset(input: {
  chain: DexChain;
  pair: string;
}): LiquidPairPreset | undefined {
  const normalizedPair = normalizePair(input.pair);
  return LIQUID_PAIR_PRESETS[input.chain]?.[normalizedPair];
}
