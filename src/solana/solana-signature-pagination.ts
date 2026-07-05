import type {
  SolanaJsonRpcClient,
  SolanaSignatureInfo,
} from "./solana-json-rpc-client.js";

export type CollectSignaturesInSlotRangeOptions = {
  client: SolanaJsonRpcClient;
  address: string;
  fromSlot: bigint;
  toSlot: bigint;
  pageLimit?: number;
  maxSignatures?: number;
  failFast?: boolean;
};

export type CollectSignaturesInSlotRangeResult = {
  signatures: SolanaSignatureInfo[];
  incompleteRangeCount: number;
};

/**
 * Pages getSignaturesForAddress (newest-first) back to the requested
 * [fromSlot, toSlot] window, client-side filtering since the RPC method
 * only supports before/until signature cursors, not slot bounds.
 */
export async function collectSignaturesInSlotRange(
  options: CollectSignaturesInSlotRangeOptions,
): Promise<CollectSignaturesInSlotRangeResult> {
  const pageLimit = options.pageLimit ?? 1000;
  const maxSignatures = options.maxSignatures ?? 200_000;
  const failFast = options.failFast ?? true;

  const collected: SolanaSignatureInfo[] = [];
  let before: string | undefined;
  let incompleteRangeCount = 0;

  while (collected.length < maxSignatures) {
    let page: SolanaSignatureInfo[];

    try {
      page = await options.client.getSignaturesForAddress(options.address, {
        limit: pageLimit,
        before,
      });
    } catch (error) {
      incompleteRangeCount += 1;
      if (failFast) throw error;
      break;
    }

    if (page.length === 0) break;

    let reachedStart = false;

    for (const item of page) {
      const slotBig = BigInt(item.slot);
      if (slotBig > options.toSlot) continue;
      if (slotBig < options.fromSlot) {
        reachedStart = true;
        break;
      }
      collected.push(item);
    }

    if (reachedStart || page.length < pageLimit) break;
    before = page[page.length - 1]!.signature;
  }

  return { signatures: collected, incompleteRangeCount };
}
