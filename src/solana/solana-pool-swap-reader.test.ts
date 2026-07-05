import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSolanaAmmPoolSwapsWithQuality } from "./solana-pool-swap-reader.js";
import type { DexPoolConfig } from "../types/dex-pool-dataset.types.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Frozen response from a real, live mainnet transaction (captured 2026-07),
 * used to regression-test the token-balance-diff decoding against ground
 * truth rather than only synthetic fixtures. See __fixtures__ for details.
 */
const fixture = JSON.parse(
  readFileSync(join(here, "__fixtures__/raydium-ray-usdc-swap-tx.json"), "utf8"),
) as { result: unknown };

const SIGNATURE =
  "2ZJVP4y77nYVupBMhKk3H5y6kPsN5qvySe1kmcnQGEkYh4PwoXqYK65d45F3K7aLg1uMVkgVqfwaRgsi8SjQi11n";
const SLOT = 430949599;

const pool: DexPoolConfig = {
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

describe("readSolanaAmmPoolSwapsWithQuality (live fixture regression)", () => {
  it("decodes a real multi-hop Raydium AMM v4 + CLMM transaction into one normalized swap", async () => {
    let sigCallCount = 0;

    const result = await readSolanaAmmPoolSwapsWithQuality({
      pool,
      rpcUrl: "http://fake",
      fromBlock: BigInt(SLOT),
      toBlock: BigInt(SLOT),
      fetchFn: async (_url, init) => {
        const body = JSON.parse(init.body as string) as { method: string };

        if (body.method === "getSignaturesForAddress") {
          sigCallCount += 1;
          const result =
            sigCallCount === 1
              ? [
                  {
                    signature: SIGNATURE,
                    slot: SLOT,
                    err: null,
                    blockTime: (fixture.result as { blockTime: number }).blockTime,
                    confirmationStatus: "finalized",
                    transactionIndex: (fixture.result as { transactionIndex: number }).transactionIndex,
                  },
                ]
              : [];
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
          };
        }

        if (body.method === "getTransaction") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: fixture.result }),
          };
        }

        throw new Error(`unexpected method ${body.method}`);
      },
    });

    expect(result.swaps).toHaveLength(1);
    const swap = result.swaps[0]!;
    expect(swap.txRef).toBe(SIGNATURE);
    expect(swap.amount0).toBeCloseTo(169.938);
    expect(swap.amount1).toBeCloseTo(120.754344);
    expect(swap.priceToken1PerToken0).toBeCloseTo(0.7105788228648096);
    expect(swap.orderingKey).toBe(`00000000000${SLOT}:00001300:${SIGNATURE}`);
    expect(result.quality.passed).toBe(true);
  });
});
