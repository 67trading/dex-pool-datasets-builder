const SLOT_PAD = 20;
const TX_INDEX_PAD = 8;

/**
 * Builds the chain-agnostic NormalizedPoolSwap.orderingKey for a Solana
 * transaction-derived swap.
 *
 * Unlike EVM logs (which have a stable per-log index), the balance-diff
 * technique treats one transaction as (at most) one swap event, so the
 * key is slot + in-slot transactionIndex, with the signature appended as
 * a tiebreaker so the key is always unique even if a provider omits
 * transactionIndex.
 */
export function buildSolanaOrderingKey(input: {
  slot: number;
  transactionIndex?: number;
  signature: string;
}): string {
  const slotPart = input.slot.toString().padStart(SLOT_PAD, "0");
  const txIndexPart = (input.transactionIndex ?? 0)
    .toString()
    .padStart(TX_INDEX_PAD, "0");
  return `${slotPart}:${txIndexPart}:${input.signature}`;
}
