import type {
  SolanaJsonRpcClient,
  SolanaSignatureInfo,
} from "./solana-json-rpc-client.js";
import type { SolanaBackfillStopReason } from "../types/dex-pool-dataset.types.js";

export type CollectSignaturesInSlotRangeOptions = {
  client: SolanaJsonRpcClient;
  address: string;
  fromSlot: bigint;
  toSlot: bigint;
  pageLimit?: number;
  maxSignatures?: number;

  /**
   * Hard cap on pages fetched, independent of how many signatures land
   * within [fromSlot, toSlot]. getSignaturesForAddress pages newest-first
   * with a before/until cursor, not a slot-range filter — for a
   * high-volume address and an old requested range, this is what actually
   * bounds the scan when the range is far in the past and few/no
   * in-range signatures are found.
   */
  maxScannedPages?: number;
  failFast?: boolean;
};

export type CollectSignaturesInSlotRangeResult = {
  signatures: SolanaSignatureInfo[];
  incompleteRangeCount: number;
  scannedSignatureCount: number;
  scannedPageCount: number;
  rangeComplete: boolean;
  stopReason: SolanaBackfillStopReason;
};

const DEFAULT_MAX_SCANNED_PAGES = 500;

/**
 * Pages getSignaturesForAddress (newest-first) back to the requested
 * [fromSlot, toSlot] window, client-side filtering since the RPC method
 * only supports before/until signature cursors, not slot bounds.
 *
 * rangeComplete is only true when the scan actually reached a signature
 * older than fromSlot (or ran out of pages entirely, meaning the address's
 * full history is older/shorter than the requested range) — never assume
 * a bounded, exhaustive backfill without checking it.
 */
export async function collectSignaturesInSlotRange(
  options: CollectSignaturesInSlotRangeOptions,
): Promise<CollectSignaturesInSlotRangeResult> {
  const pageLimit = options.pageLimit ?? 1000;
  const maxSignatures = options.maxSignatures ?? 200_000;
  const maxScannedPages = options.maxScannedPages ?? DEFAULT_MAX_SCANNED_PAGES;
  const failFast = options.failFast ?? true;

  const collected: SolanaSignatureInfo[] = [];
  let before: string | undefined;
  let incompleteRangeCount = 0;
  let scannedSignatureCount = 0;
  let scannedPageCount = 0;
  let stopReason: SolanaBackfillStopReason = "EMPTY_PAGE";
  let rangeComplete = false;

  outer: while (true) {
    if (collected.length >= maxSignatures) {
      stopReason = "MAX_SIGNATURES_COLLECTED";
      break;
    }
    if (scannedPageCount >= maxScannedPages) {
      stopReason = "MAX_SCANNED_PAGES";
      break;
    }

    let page: SolanaSignatureInfo[];

    try {
      page = await options.client.getSignaturesForAddress(options.address, {
        limit: pageLimit,
        before,
      });
    } catch (error) {
      incompleteRangeCount += 1;
      stopReason = "RPC_LIMIT";
      if (failFast) throw error;
      break;
    }

    scannedPageCount += 1;
    scannedSignatureCount += page.length;

    if (page.length === 0) {
      // Exhausted the address's entire history — everything from
      // fromSlot forward (if any existed) has been seen.
      stopReason = "EMPTY_PAGE";
      rangeComplete = true;
      break;
    }

    let reachedStart = false;

    for (const item of page) {
      // Enforce maxSignatures as a real hard cap even mid-page, rather
      // than only checking it between pages (a single page can contain
      // far more in-range signatures than the requested cap).
      if (collected.length >= maxSignatures) {
        stopReason = "MAX_SIGNATURES_COLLECTED";
        break outer;
      }

      const slotBig = BigInt(item.slot);
      if (slotBig > options.toSlot) continue;
      if (slotBig < options.fromSlot) {
        reachedStart = true;
        break;
      }
      collected.push(item);
    }

    if (reachedStart) {
      stopReason = "REACHED_FROM_SLOT";
      rangeComplete = true;
      break;
    }

    if (page.length < pageLimit) {
      // Short page with nothing older than fromSlot found — same as
      // exhausting history.
      stopReason = "EMPTY_PAGE";
      rangeComplete = true;
      break;
    }

    before = page[page.length - 1]!.signature;
  }

  return {
    signatures: collected,
    incompleteRangeCount,
    scannedSignatureCount,
    scannedPageCount,
    rangeComplete,
    stopReason,
  };
}
