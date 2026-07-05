const BLOCK_NUMBER_PAD = 20;
const INDEX_PAD = 6;

/**
 * Builds the chain-agnostic NormalizedPoolSwap.orderingKey for an EVM log.
 *
 * Zero-padded so lexicographic string comparison equals chronological
 * block -> transactionIndex -> logIndex ordering.
 */
export function buildEvmOrderingKey(input: {
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
}): string {
  return [
    input.blockNumber.toString().padStart(BLOCK_NUMBER_PAD, "0"),
    input.transactionIndex.toString().padStart(INDEX_PAD, "0"),
    input.logIndex.toString().padStart(INDEX_PAD, "0"),
  ].join(":");
}
