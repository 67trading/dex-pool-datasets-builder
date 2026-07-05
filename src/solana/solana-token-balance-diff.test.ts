import { describe, expect, it } from "vitest";
import {
  computeMintGrossDelta,
  formatRawAmount,
} from "./solana-token-balance-diff.js";
import type { SolanaTokenBalance } from "./solana-json-rpc-client.js";

const MINT_A = "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MINT_B = "MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function balance(accountIndex: number, mint: string, amount: string): SolanaTokenBalance {
  return {
    accountIndex,
    mint,
    uiTokenAmount: { amount, decimals: 6, uiAmount: null, uiAmountString: "" },
  };
}

describe("computeMintGrossDelta", () => {
  it("computes the closed, balanced gross transfer amount for a simple two-account swap", () => {
    const meta = {
      preTokenBalances: [balance(0, MINT_A, "1000"), balance(1, MINT_A, "0")],
      postTokenBalances: [balance(0, MINT_A, "700"), balance(1, MINT_A, "300")],
    };

    expect(computeMintGrossDelta(meta, MINT_A)).toEqual({ grossRaw: 300n, balanced: true });
  });

  it("returns 0/balanced when a mint doesn't move", () => {
    const meta = {
      preTokenBalances: [balance(0, MINT_A, "1000")],
      postTokenBalances: [balance(0, MINT_A, "1000")],
    };

    expect(computeMintGrossDelta(meta, MINT_A)).toEqual({ grossRaw: 0n, balanced: true });
  });

  it("ignores unrelated mints", () => {
    const meta = {
      preTokenBalances: [balance(0, MINT_A, "1000"), balance(1, MINT_B, "500")],
      postTokenBalances: [balance(0, MINT_A, "900"), balance(1, MINT_B, "600")],
    };

    expect(computeMintGrossDelta(meta, MINT_A).grossRaw).toBe(100n);
    expect(computeMintGrossDelta(meta, MINT_B).grossRaw).toBe(100n);
  });

  it("takes the max of positive/negative sums and flags unbalanced when a transient account is invisible on one side", () => {
    // Account 2 is created within the tx (absent from preTokenBalances) and
    // closed by the end (absent from postTokenBalances) — a common
    // wrap-SOL -> swap -> unwrap pattern. The positive side captures the
    // full gross amount; the negative side would undercount without the max().
    const meta = {
      preTokenBalances: [balance(0, MINT_A, "1000")],
      postTokenBalances: [balance(0, MINT_A, "1000"), balance(2, MINT_A, "500")],
    };

    expect(computeMintGrossDelta(meta, MINT_A)).toEqual({ grossRaw: 500n, balanced: false });
  });

  it("handles missing balance arrays as empty and balanced", () => {
    expect(computeMintGrossDelta({}, MINT_A)).toEqual({ grossRaw: 0n, balanced: true });
  });
});

describe("formatRawAmount", () => {
  it("adjusts a raw integer amount by decimals", () => {
    expect(formatRawAmount(169_938_000n, 6)).toBeCloseTo(169.938);
    expect(formatRawAmount(120_754_344n, 6)).toBeCloseTo(120.754344);
  });
});
