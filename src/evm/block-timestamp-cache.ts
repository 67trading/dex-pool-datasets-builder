import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvmJsonRpcClient } from "./evm-json-rpc-client.js";
import { hexToNumber } from "./evm-json-rpc-client.js";

const EVM_BLOCK_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export type CachedBlockTimestamp = {
  hash: string;
  timestamp: number;
};

export type BlockTimestampCacheOptions = {
  maxEntries?: number;

  /**
   * Optional persistent JSONL cache path.
   *
   * Example:
   * .data/cache/base/block-timestamps.jsonl
   */
  persistentPath?: string;
};

export class BlockTimestampCache {
  private readonly timestamps = new Map<string, CachedBlockTimestamp>();
  private loadedPersistent = false;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(
    private readonly client: EvmJsonRpcClient,
    private readonly options: BlockTimestampCacheOptions = {},
  ) {}

  async getTimestamp(blockNumber: bigint): Promise<number> {
    await this.loadPersistentIfNeeded();

    const key = blockNumber.toString();
    const cached = this.timestamps.get(key);

    if (cached !== undefined && isValidBlockHash(cached.hash)) {
      this.cacheHits += 1;
      return cached.timestamp;
    }

    if (cached !== undefined) {
      this.timestamps.delete(key);
    }

    this.cacheMisses += 1;

    const block = await this.client.getBlockByNumber(blockNumber);
    const timestamp = parseBlockTimestamp(block.timestamp, blockNumber);

    const record: CachedBlockTimestamp = {
      hash: block.hash,
      timestamp,
    };

    this.evictIfNeeded();
    this.timestamps.set(key, record);

    if (isValidBlockHash(block.hash)) {
      await this.appendPersistent(blockNumber, record);
    }

    return timestamp;
  }

  async getBlockTimestamp(blockNumber: bigint): Promise<CachedBlockTimestamp> {
    await this.loadPersistentIfNeeded();

    const key = blockNumber.toString();
    const cached = this.timestamps.get(key);

    if (cached !== undefined) {
      if (!isValidBlockHash(cached.hash)) {
        this.timestamps.delete(key);
      } else {
        this.cacheHits += 1;
        return cached;
      }
    }

    this.cacheMisses += 1;

    const block = await this.client.getBlockByNumber(blockNumber);

    if (!isValidBlockHash(block.hash)) {
      throw new Error(
        `EVM_BLOCK_HASH_INVALID:${blockNumber.toString()}:${block.hash}`,
      );
    }

    const record: CachedBlockTimestamp = {
      hash: block.hash,
      timestamp: parseBlockTimestamp(block.timestamp, blockNumber),
    };

    this.evictIfNeeded();
    this.timestamps.set(key, record);

    await this.appendPersistent(blockNumber, record);

    return record;
  }

  get size(): number {
    return this.timestamps.size;
  }

  get stats(): { hits: number; misses: number; size: number } {
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      size: this.timestamps.size,
    };
  }

  private async loadPersistentIfNeeded(): Promise<void> {
    if (this.loadedPersistent) {
      return;
    }

    this.loadedPersistent = true;

    if (this.options.persistentPath === undefined) {
      return;
    }

    let text: string;

    try {
      text = await readFile(this.options.persistentPath, "utf8");
    } catch {
      return;
    }

    for (const line of text.split("\n")) {
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed) as {
          blockNumber?: string;
          hash?: string;
          timestamp?: number;
        };

        if (
          typeof parsed.blockNumber === "string" &&
          typeof parsed.hash === "string" &&
          typeof parsed.timestamp === "number" &&
          isValidBlockHash(parsed.hash)
        ) {
          this.timestamps.set(parsed.blockNumber, {
            hash: parsed.hash,
            timestamp: parsed.timestamp,
          });
        }
      } catch {
        continue;
      }
    }
  }

  private async appendPersistent(
    blockNumber: bigint,
    record: CachedBlockTimestamp,
  ): Promise<void> {
    if (this.options.persistentPath === undefined) {
      return;
    }

    await mkdir(dirname(this.options.persistentPath), { recursive: true });

    await appendFile(
      this.options.persistentPath,
      `${JSON.stringify({
        blockNumber: blockNumber.toString(),
        hash: record.hash,
        timestamp: record.timestamp,
      })}\n`,
      "utf8",
    );
  }

  private evictIfNeeded(): void {
    const maxEntries = this.options.maxEntries ?? 100_000;

    if (maxEntries <= 0) {
      this.timestamps.clear();
      return;
    }

    while (this.timestamps.size >= maxEntries) {
      const oldestKey = this.timestamps.keys().next().value as
        | string
        | undefined;

      if (oldestKey === undefined) {
        return;
      }

      this.timestamps.delete(oldestKey);
    }
  }
}

function isValidBlockHash(value: string): boolean {
  return EVM_BLOCK_HASH_PATTERN.test(value);
}

function parseBlockTimestamp(value: unknown, blockNumber: bigint): number {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`EVM_BLOCK_TIMESTAMP_MISSING:${blockNumber.toString()}`);
  }

  try {
    return hexToNumber(value as `0x${string}`);
  } catch (error) {
    throw new Error(
      `EVM_BLOCK_TIMESTAMP_INVALID:${blockNumber.toString()}:${value}`,
      {
        cause: error,
      },
    );
  }
}
