import { describe, expect, it } from "vitest";
import { validatePoolRegistry } from "./pool-registry.js";

const validSolanaPool = {
  id: "solana-raydium-ray-usdc",
  chain: "solana",
  dex: "raydium",
  kind: "SOLANA_AMM_STYLE",
  poolAddress: "6UmmUiYoBjSrhakAobJw8BvkmJtDVxaeBtbt7rxWo1mg",
  programId: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  token0: { symbol: "RAY", address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", decimals: 6 },
  token1: { symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  baseToken: "token0",
  quoteToken: "token1",
  startBlock: "430949599",
};

const validEvmPool = {
  id: "base-uniswap-v3-weth-usdc",
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

describe("validatePoolRegistry — Solana entries", () => {
  it("accepts a well-formed Solana pool entry", () => {
    const result = validatePoolRegistry([validSolanaPool]);
    expect(result.errors).toEqual([]);
    expect(result.pools).toHaveLength(1);
  });

  it("rejects a Solana pool with an EVM-style hex address", () => {
    const result = validatePoolRegistry([
      { ...validSolanaPool, poolAddress: "0x0000000000000000000000000000000000000001" },
    ]);
    expect(result.errors.some((e) => e.includes("POOL_ADDRESS_INVALID"))).toBe(true);
  });

  it("rejects a Solana pool missing programId", () => {
    const { programId: _drop, ...withoutProgramId } = validSolanaPool;
    const result = validatePoolRegistry([withoutProgramId]);
    expect(result.errors.some((e) => e.includes("POOL_PROGRAM_ID_MISSING"))).toBe(true);
  });

  it("still validates EVM pools with hex addresses (no regression)", () => {
    const result = validatePoolRegistry([validEvmPool]);
    expect(result.errors).toEqual([]);
    expect(result.pools).toHaveLength(1);
  });

  it("rejects an EVM pool with a Solana-style base58 address", () => {
    const result = validatePoolRegistry([
      { ...validEvmPool, poolAddress: "6UmmUiYoBjSrhakAobJw8BvkmJtDVxaeBtbt7rxWo1mg" },
    ]);
    expect(result.errors.some((e) => e.includes("POOL_ADDRESS_INVALID"))).toBe(true);
  });
});
