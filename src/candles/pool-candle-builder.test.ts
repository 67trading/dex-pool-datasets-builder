import { describe, expect, it } from "vitest";
import { buildCandlesFromSwaps } from "./pool-candle-builder.js";
import type {
  DexPoolConfig,
  NormalizedPoolSwap,
} from "../types/dex-pool-dataset.types.js";

const evmPool: DexPoolConfig = {
  id: "evm-pool",
  chain: "base",
  dex: "uniswap_v3",
  kind: "UNISWAP_V3_STYLE",
  poolAddress: "0x0000000000000000000000000000000000000001",
  token0: { symbol: "WETH", address: "0x0000000000000000000000000000000000000002", decimals: 18 },
  token1: { symbol: "USDC", address: "0x0000000000000000000000000000000000000003", decimals: 6 },
  baseToken: "token0",
  quoteToken: "token1",
  startBlock: "1",
};

const solanaPool: DexPoolConfig = {
  id: "solana-pool",
  chain: "solana",
  dex: "raydium",
  kind: "SOLANA_AMM_STYLE",
  poolAddress: "6UmmUiYoBjSrhakAobJw8BvkmJtDVxaeBtbt7rxWo1mg",
  programId: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  token0: { symbol: "RAY", address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", decimals: 6 },
  token1: { symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  baseToken: "token0",
  quoteToken: "token1",
  startBlock: "1",
};

function evmSwap(overrides: Partial<NormalizedPoolSwap>): NormalizedPoolSwap {
  return {
    chain: "base",
    dex: "uniswap_v3",
    poolAddress: evmPool.poolAddress,
    orderingKey: "00000000000000000100:000000:000000",
    txRef: "0xaaa",
    blockTimestamp: 1_700_000_000,
    token0Symbol: "WETH",
    token1Symbol: "USDC",
    amount0: 1,
    amount1: 2000,
    priceToken1PerToken0: 2000,
    priceToken0PerToken1: 1 / 2000,
    ...overrides,
  };
}

function solanaSwap(overrides: Partial<NormalizedPoolSwap>): NormalizedPoolSwap {
  return {
    chain: "solana",
    dex: "raydium",
    poolAddress: solanaPool.poolAddress,
    orderingKey: "00000000000430949599:00001300:sig1",
    txRef: "sig1",
    blockTimestamp: 1_700_000_000,
    token0Symbol: "RAY",
    token1Symbol: "USDC",
    amount0: 169.938,
    amount1: 120.754344,
    priceToken1PerToken0: 0.7105788228648096,
    priceToken0PerToken1: 1.4073034093084054,
    ...overrides,
  };
}

describe("buildCandlesFromSwaps — generic contract", () => {
  it("builds OHLCV candles from EVM-shaped orderingKeys, ordered chronologically", () => {
    const swaps: NormalizedPoolSwap[] = [
      evmSwap({
        orderingKey: "00000000000000000100:000000:000001",
        txRef: "0xaaa",
        blockTimestamp: 1_700_000_010,
        priceToken1PerToken0: 2000,
      }),
      evmSwap({
        orderingKey: "00000000000000000100:000000:000000",
        txRef: "0xbbb",
        blockTimestamp: 1_700_000_000,
        priceToken1PerToken0: 1900,
      }),
    ];

    const candles = buildCandlesFromSwaps({ pool: evmPool, swaps, timeframe: "1m" });

    expect(candles).toHaveLength(1);
    expect(candles[0]!.open).toBe(1900);
    expect(candles[0]!.close).toBe(2000);
    expect(candles[0]!.tradeCount).toBe(2);
    expect(candles[0]!.source.fromOrderingKey).toBe("00000000000000000100:000000:000000");
    expect(candles[0]!.source.toOrderingKey).toBe("00000000000000000100:000000:000001");
  });

  it("builds OHLCV candles from Solana-shaped orderingKeys using the same code path", () => {
    const swaps: NormalizedPoolSwap[] = [
      solanaSwap({ orderingKey: "00000000000430949599:00001300:sigA", txRef: "sigA", priceToken1PerToken0: 0.71 }),
      solanaSwap({ orderingKey: "00000000000430949600:00000010:sigB", txRef: "sigB", priceToken1PerToken0: 0.72 }),
    ];

    const candles = buildCandlesFromSwaps({ pool: solanaPool, swaps, timeframe: "1m" });

    expect(candles).toHaveLength(1);
    expect(candles[0]!.chain).toBe("solana");
    expect(candles[0]!.open).toBe(0.71);
    expect(candles[0]!.close).toBe(0.72);
    expect(candles[0]!.source.txRefRange).toEqual(["sigA", "sigB"]);
  });

  it("throws on duplicate orderingKey", () => {
    const swaps: NormalizedPoolSwap[] = [
      solanaSwap({ orderingKey: "dup", txRef: "sigA" }),
      solanaSwap({ orderingKey: "dup", txRef: "sigB" }),
    ];

    expect(() => buildCandlesFromSwaps({ pool: solanaPool, swaps, timeframe: "1m" })).toThrow(
      /DUPLICATE_SWAP_EVENT/,
    );
  });

  it("rejects a non-positive derived price regardless of chain", () => {
    const swaps: NormalizedPoolSwap[] = [
      solanaSwap({ priceToken1PerToken0: 0, priceToken0PerToken1: 0 }),
    ];

    expect(() => buildCandlesFromSwaps({ pool: solanaPool, swaps, timeframe: "1m" })).toThrow(
      /INVALID_DERIVED_PRICE/,
    );
  });
});
