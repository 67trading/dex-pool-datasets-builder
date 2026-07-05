import { describe, expect, it } from "vitest";
import { collectSignaturesInSlotRange } from "./solana-signature-pagination.js";
import type {
  SolanaJsonRpcClient,
  SolanaSignatureInfo,
} from "./solana-json-rpc-client.js";

function sig(slot: number, signature: string): SolanaSignatureInfo {
  return { signature, slot, err: null, blockTime: 1_700_000_000, confirmationStatus: "finalized" };
}

function fakeClient(pages: SolanaSignatureInfo[][]): SolanaJsonRpcClient {
  let call = 0;
  return {
    getSignaturesForAddress: async () => pages[call++] ?? [],
    getTransaction: async () => null,
    getSlot: async () => 0,
    getAccountInfo: async () => null,
  };
}

describe("collectSignaturesInSlotRange", () => {
  it("stops with REACHED_FROM_SLOT and rangeComplete=true once older-than-range signatures appear", async () => {
    const client = fakeClient([
      [sig(110, "a"), sig(105, "b"), sig(90, "c")], // 90 is below fromSlot=100
    ]);

    const result = await collectSignaturesInSlotRange({
      client,
      address: "addr",
      fromSlot: 100n,
      toSlot: 120n,
      pageLimit: 1000,
    });

    expect(result.rangeComplete).toBe(true);
    expect(result.stopReason).toBe("REACHED_FROM_SLOT");
    expect(result.signatures.map((s) => s.signature)).toEqual(["a", "b"]);
  });

  it("stops with MAX_SCANNED_PAGES and rangeComplete=false for a far historical range on a high-volume address", async () => {
    // Every page is full and stays above toSlot — simulates scanning a
    // high-volume address for a range far in the past that the page
    // budget never reaches.
    const fullPage = Array.from({ length: 5 }, (_, i) => sig(1_000_000 - i, `s${i}`));
    const client = fakeClient([fullPage, fullPage, fullPage, fullPage]);

    const result = await collectSignaturesInSlotRange({
      client,
      address: "addr",
      fromSlot: 1n,
      toSlot: 1000n,
      pageLimit: 5,
      maxScannedPages: 3,
    });

    expect(result.rangeComplete).toBe(false);
    expect(result.stopReason).toBe("MAX_SCANNED_PAGES");
    expect(result.signatures).toEqual([]);
    expect(result.scannedPageCount).toBe(3);
  });

  it("stops with EMPTY_PAGE and rangeComplete=true when the address's history is exhausted before reaching fromSlot", async () => {
    const client = fakeClient([[sig(50, "a")], []]);

    const result = await collectSignaturesInSlotRange({
      client,
      address: "addr",
      fromSlot: 1n,
      toSlot: 1000n,
      pageLimit: 1000,
    });

    expect(result.rangeComplete).toBe(true);
    expect(result.stopReason).toBe("EMPTY_PAGE");
  });

  it("enforces maxSignatures as a real hard cap even mid-page, not just between pages", async () => {
    // A single page can contain far more in-range signatures than the
    // requested cap — the cap must be checked while walking the page,
    // not only once per page.
    const page = Array.from({ length: 10 }, (_, i) => sig(100 + i, `s${i}`));
    const client = fakeClient([page, page, page]);

    const result = await collectSignaturesInSlotRange({
      client,
      address: "addr",
      fromSlot: 0n,
      toSlot: 1000n,
      pageLimit: 10,
      maxSignatures: 5,
    });

    expect(result.signatures).toHaveLength(5);
    expect(result.stopReason).toBe("MAX_SIGNATURES_COLLECTED");
    expect(result.rangeComplete).toBe(false);
  });
});
