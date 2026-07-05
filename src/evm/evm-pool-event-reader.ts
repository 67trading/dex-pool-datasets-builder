import type {
  DexPoolConfig,
  DexPoolQualitySummary,
  NormalizedPoolSwap,
} from "../types/dex-pool-dataset.types.js";
import type { DexBuildProgressHandler } from "../orchestrator/dex-build-progress.types.js";
import { planBlockRanges } from "./block-range-planner.js";
import { BlockTimestampCache } from "./block-timestamp-cache.js";
import {
  createEvmJsonRpcClient,
  hexToBigInt,
  hexToNumber,
  type EvmLog,
  type EvmRpcFetch,
  type HexString,
} from "./evm-json-rpc-client.js";
import {
  decodeUniswapV3SwapLog,
  UNISWAP_V3_SWAP_TOPIC,
} from "./uniswap-v3-swap-decoder.js";

export type ReadUniswapV3PoolSwapsWithQualityOptions = {
  pool: DexPoolConfig;
  rpcUrl: string;
  fromBlock: bigint;
  toBlock: bigint;
  chunkSize?: bigint;
  fetchFn?: EvmRpcFetch;
  failFast?: boolean;

  /**
   * Optional persistent timestamp cache path.
   *
   * Example:
   * .data/cache/base/block-timestamps.jsonl
   */
  timestampCachePath?: string;

  /**
   * Optional progress callback used by the CLI in --verbose mode.
   */
  onProgress?: DexBuildProgressHandler;
};

export type ReadUniswapV3PoolSwapsWithQualityResult = {
  swaps: NormalizedPoolSwap[];
  quality: DexPoolQualitySummary;
};

export async function readUniswapV3PoolSwapsWithQuality(
  options: ReadUniswapV3PoolSwapsWithQualityOptions,
): Promise<ReadUniswapV3PoolSwapsWithQualityResult> {
  if (options.pool.kind !== "UNISWAP_V3_STYLE") {
    throw new Error(`DEX_POOL_KIND_UNSUPPORTED:${options.pool.kind}`);
  }

  const failFast = options.failFast ?? true;
  const chunkSize = options.chunkSize ?? 5_000n;

  const client = createEvmJsonRpcClient({
    rpcUrl: options.rpcUrl,
    fetchFn: options.fetchFn,
  });

  const timestampCache = new BlockTimestampCache(client, {
    persistentPath: options.timestampCachePath,
  });

  const ranges = planBlockRanges(options.fromBlock, options.toBlock, chunkSize);

  options.onProgress?.({
    type: "logs_read_start",
    poolId: options.pool.id,
    chunks: ranges.length,
    fromBlock: options.fromBlock.toString(),
    toBlock: options.toBlock.toString(),
  });

  const swaps: NormalizedPoolSwap[] = [];
  const seenLogs = new Set<string>();
  const seenBlockHashes = new Map<string, string>();

  const quality: DexPoolQualitySummary = {
    passed: true,
    reorgConflicts: 0,
    invalidLogs: 0,
    duplicateLogs: 0,
    missingBlockTimestamps: 0,
    incompleteBlockRanges: 0,
    extremeWickCandles: 0,
    noTradeIntervals: 0,
  };

  let timestampLookups = 0;

  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
    const range = ranges[rangeIndex]!;
    const index = rangeIndex + 1;

    options.onProgress?.({
      type: "logs_chunk_start",
      poolId: options.pool.id,
      index,
      total: ranges.length,
      fromBlock: range.fromBlock.toString(),
      toBlock: range.toBlock.toString(),
    });

    let logs: EvmLog[];

    try {
      logs = await client.getLogs({
        address: options.pool.poolAddress as HexString,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        topics: [UNISWAP_V3_SWAP_TOPIC],
      });

      options.onProgress?.({
        type: "logs_chunk_done",
        poolId: options.pool.id,
        index,
        total: ranges.length,
        logCount: logs.length,
      });
    } catch (error) {
      quality.incompleteBlockRanges += 1;
      quality.passed = false;

      if (failFast) {
        throw error;
      }

      continue;
    }

    for (const log of logs) {
      let identity: CanonicalLogIdentity;

      try {
        identity = canonicalLogIdentity(log);
      } catch (error) {
        quality.invalidLogs += 1;
        quality.passed = false;

        if (failFast) {
          throw error;
        }

        continue;
      }

      const logKey = `${identity.transactionHash}:${identity.logIndex}`;

      if (seenLogs.has(logKey)) {
        quality.duplicateLogs += 1;
        quality.passed = false;

        if (failFast) {
          throw new Error(`DEX_DUPLICATE_LOG:${logKey}`);
        }

        continue;
      }

      seenLogs.add(logKey);

      const blockNumber = identity.blockNumber;
      const previousHash = seenBlockHashes.get(blockNumber.toString());

      if (previousHash !== undefined && previousHash !== log.blockHash) {
        quality.reorgConflicts += 1;
        quality.passed = false;

        if (failFast) {
          throw new Error(
            `DEX_REORG_CONFLICT:${blockNumber.toString()}:${previousHash}:${log.blockHash}`,
          );
        }

        continue;
      }

      seenBlockHashes.set(blockNumber.toString(), log.blockHash);

      let blockTimestamp: number;

      try {
        const timestampRecord =
          await timestampCache.getBlockTimestamp(blockNumber);

        if (timestampRecord.hash !== log.blockHash) {
          quality.reorgConflicts += 1;
          quality.passed = false;

          if (failFast) {
            throw new Error(
              `EVM_REORG_CONFLICT:${blockNumber.toString()}:${timestampRecord.hash}:${log.blockHash}`,
            );
          }

          continue;
        }

        blockTimestamp = timestampRecord.timestamp;
        timestampLookups += 1;

        if (timestampLookups % 1000 === 0) {
          const stats = timestampCache.stats;

          options.onProgress?.({
            type: "timestamps_progress",
            poolId: options.pool.id,
            done: timestampLookups,
            total: -1,
            cacheHits: stats.hits,
            cacheMisses: stats.misses,
          });
        }
      } catch (error) {
        quality.missingBlockTimestamps += 1;
        quality.passed = false;

        if (failFast) {
          throw error;
        }

        continue;
      }

      let decoded: NormalizedPoolSwap;

      try {
        decoded = decodeUniswapV3SwapLog({
          pool: options.pool,
          log,
          blockTimestamp,
        });
      } catch (error) {
        quality.invalidLogs += 1;
        quality.passed = false;

        if (failFast) {
          throw error;
        }

        continue;
      }

      swaps.push(decoded);
    }
  }

  swaps.sort((a, b) => {
    if (a.orderingKey < b.orderingKey) return -1;
    if (a.orderingKey > b.orderingKey) return 1;
    return 0;
  });

  const stats = timestampCache.stats;

  if (timestampLookups > 0) {
    options.onProgress?.({
      type: "timestamps_progress",
      poolId: options.pool.id,
      done: timestampLookups,
      total: timestampLookups,
      cacheHits: stats.hits,
      cacheMisses: stats.misses,
    });
  }

  options.onProgress?.({
    type: "swaps_decoded",
    poolId: options.pool.id,
    swaps: swaps.length,
  });

  return {
    swaps,
    quality,
  };
}

type CanonicalLogIdentity = {
  transactionHash: string;
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
};

function canonicalLogIdentity(log: EvmLog): CanonicalLogIdentity {
  const transactionHash = log.transactionHash.toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(transactionHash)) {
    throw new Error(`EVM_LOG_TRANSACTION_HASH_INVALID:${log.transactionHash}`);
  }

  return {
    transactionHash,
    blockNumber: hexToBigInt(log.blockNumber),
    transactionIndex: hexToNumber(log.transactionIndex),
    logIndex: hexToNumber(log.logIndex),
  };
}

export async function readUniswapV3PoolSwaps(
  options: ReadUniswapV3PoolSwapsWithQualityOptions,
): Promise<NormalizedPoolSwap[]> {
  const { swaps } = await readUniswapV3PoolSwapsWithQuality({
    ...options,
    failFast: true,
  });
  return swaps;
}
