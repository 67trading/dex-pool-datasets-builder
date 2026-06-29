export type BlockRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

export function planBlockRanges(
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
): BlockRange[] {
  if (fromBlock < 0n) {
    throw new Error(`BLOCK_RANGE_FROM_NEGATIVE:${fromBlock.toString()}`);
  }
  if (toBlock < fromBlock) {
    throw new Error(
      `BLOCK_RANGE_INVALID:${fromBlock.toString()}:${toBlock.toString()}`,
    );
  }
  if (chunkSize <= 0n) {
    throw new Error(`BLOCK_RANGE_CHUNK_INVALID:${chunkSize.toString()}`);
  }

  const ranges: BlockRange[] = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const end = cursor + chunkSize - 1n;
    ranges.push({
      fromBlock: cursor,
      toBlock: end > toBlock ? toBlock : end,
    });
    cursor = end + 1n;
  }
  return ranges;
}
