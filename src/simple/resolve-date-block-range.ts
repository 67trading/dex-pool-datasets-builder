import type { EvmJsonRpcClient } from "../evm/evm-json-rpc-client.js";
import { hexToNumber } from "../evm/evm-json-rpc-client.js";

export type ResolvedDateBlockRange = {
  fromBlock: bigint;
  toBlock: bigint;
  fromTimestamp: number;
  toTimestamp: number;
  latestBlock: bigint;
};

export async function resolveDateBlockRange(input: {
  client: EvmJsonRpcClient;
  from: string;
  to: string;
}): Promise<ResolvedDateBlockRange> {
  const fromTimestamp = parseUserTimeToSeconds(input.from);
  const toTimestamp = parseUserTimeToSeconds(input.to);

  if (toTimestamp <= fromTimestamp) {
    throw new Error(`SIMPLE_DATE_RANGE_INVALID:${input.from}:${input.to}`);
  }

  const latestBlock = await input.client.getLatestBlockNumber();
  const timestampCache = new Map<string, number>();

  const getTimestamp = async (blockNumber: bigint): Promise<number> => {
    const key = blockNumber.toString();
    const cached = timestampCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const block = await input.client.getBlockByNumber(blockNumber);
    const timestamp = hexToNumber(block.timestamp);
    timestampCache.set(key, timestamp);

    return timestamp;
  };

  const fromBlock = await findFirstBlockAtOrAfter({
    latestBlock,
    targetTimestamp: fromTimestamp,
    lowBlock: 0n,
    getTimestamp,
  });

  const toBoundaryBlock = await findFirstBlockAtOrAfter({
    latestBlock,
    targetTimestamp: toTimestamp,
    lowBlock: fromBlock,
    getTimestamp,
  });

  const toBoundaryTimestamp = await getTimestamp(toBoundaryBlock);

  const toBlock =
    toBoundaryTimestamp >= toTimestamp && toBoundaryBlock > 0n
      ? toBoundaryBlock - 1n
      : toBoundaryBlock;

  if (toBlock < fromBlock) {
    throw new Error(
      `SIMPLE_BLOCK_RANGE_EMPTY:${fromBlock.toString()}:${toBlock.toString()}:${input.from}:${input.to}`,
    );
  }

  return {
    fromBlock,
    toBlock,
    fromTimestamp,
    toTimestamp,
    latestBlock,
  };
}

async function findFirstBlockAtOrAfter(input: {
  latestBlock: bigint;
  targetTimestamp: number;
  lowBlock: bigint;
  getTimestamp: (blockNumber: bigint) => Promise<number>;
}): Promise<bigint> {
  const lowTimestamp = await input.getTimestamp(input.lowBlock);

  if (input.targetTimestamp <= lowTimestamp) {
    return input.lowBlock;
  }

  const latestTimestamp = await input.getTimestamp(input.latestBlock);

  if (input.targetTimestamp > latestTimestamp) {
    return input.latestBlock;
  }

  let low = input.lowBlock;
  let high = input.latestBlock;

  while (low < high) {
    const mid = (low + high) / 2n;
    const midTimestamp = await input.getTimestamp(mid);

    if (midTimestamp >= input.targetTimestamp) {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }

  return low;
}

export function parseUserTimeToSeconds(value: string): number {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value;

  const ms = Date.parse(normalized);

  if (!Number.isFinite(ms)) {
    throw new Error(`SIMPLE_DATE_INVALID:${value}`);
  }

  return Math.floor(ms / 1000);
}
