import {
  appendFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import {
  createEvmJsonRpcClient,
  hexToBigInt,
  type EvmJsonRpcClient,
} from "../evm/evm-json-rpc-client.js";
import { planBlockRanges } from "../evm/block-range-planner.js";
import { getUniswapV3FactoryPreset } from "../simple/uniswap-v3-factory-presets.js";
import type { DexChain } from "../types/dex-pool-dataset.types.js";
import type {
  UniswapV3PoolCacheRow,
  UniswapV3PoolCacheState,
  UniswapV3PoolCandidate,
} from "./discovery.types.js";
import {
  decodeUniswapV3PoolCreatedLog,
  poolCreatedRowToCandidate,
  UNISWAP_V3_POOL_CREATED_TOPIC,
} from "./uniswap-v3-pool-created-decoder.js";

const CACHE_VERSION = 1;
const DEFAULT_CACHE_DIR = ".data/cache";
const DEFAULT_FACTORY_SCAN_CHUNK_SIZE = 10_000n;

export type DiscoveryCachePaths = {
  poolsPath: string;
  statePath: string;
};

export type DiscoveryCacheProgressEvent =
  | {
      type: "scan_start";
      chunks: number;
      fromBlock: bigint;
      toBlock: bigint;
    }
  | {
      type: "scan_chunk";
      index: number;
      total: number;
      fromBlock: bigint;
      toBlock: bigint;
    }
  | { type: "scan_done"; foundPools: number; scannedToBlock: bigint };

export type DiscoveryCacheStatus = {
  state: UniswapV3PoolCacheState;
  safeLatestBlock: bigint;
  lagBlocks: bigint;
  paths: DiscoveryCachePaths;
};

export type DiscoveryCacheInitResult = {
  state: UniswapV3PoolCacheState;
  rows: UniswapV3PoolCacheRow[];
  paths: DiscoveryCachePaths;
};

export function getDiscoveryCachePaths(input: {
  chain: DexChain;
  cacheDir?: string;
}): DiscoveryCachePaths {
  const root = input.cacheDir ?? DEFAULT_CACHE_DIR;
  const dir = join(root, input.chain);

  return {
    poolsPath: join(dir, "uniswap-v3-pools.jsonl"),
    statePath: join(dir, "uniswap-v3-pools.state.json"),
  };
}

export async function discoveryCacheExists(input: {
  chain: DexChain;
  cacheDir?: string;
}): Promise<boolean> {
  const paths = getDiscoveryCachePaths(input);

  try {
    await stat(paths.statePath);
    await stat(paths.poolsPath);
    return true;
  } catch {
    return false;
  }
}

export async function initializeDiscoveryCache(input: {
  chain: DexChain;
  rpcUrl: string;
  cacheDir?: string;
  onProgress?: (event: DiscoveryCacheProgressEvent) => void;
}): Promise<DiscoveryCacheInitResult> {
  const client = createEvmJsonRpcClient({ rpcUrl: input.rpcUrl });
  const latestBlock = await client.getLatestBlockNumber();
  const factoryPreset = getUniswapV3FactoryPreset(input.chain);
  const paths = getDiscoveryCachePaths(input);
  const current = await loadDiscoveryCacheStateOrStartFresh({
    chain: input.chain,
    cacheDir: input.cacheDir,
  });
  const startBlock =
    current.state !== undefined
      ? BigInt(current.state!.scannedToBlock) + 1n
      : factoryPreset.deploymentBlock;
  const result = await scanAndPersistPoolCreatedRows({
    client,
    chain: input.chain,
    paths,
    factoryAddress: factoryPreset.factoryAddress,
    deploymentBlock: factoryPreset.deploymentBlock,
    existingPoolAddresses: current.poolAddresses,
    fromBlock: startBlock,
    toBlock: latestBlock,
    safeLatestBlock: latestBlock,
    onProgress: input.onProgress,
  });

  input.onProgress?.({
    type: "scan_done",
    foundPools: result.addedRows,
    scannedToBlock: BigInt(result.state.scannedToBlock),
  });

  return {
    state: result.state,
    rows: result.rows,
    paths,
  };
}

export async function refreshDiscoveryCache(input: {
  chain: DexChain;
  rpcUrl: string;
  cacheDir?: string;
  onProgress?: (event: DiscoveryCacheProgressEvent) => void;
}): Promise<DiscoveryCacheInitResult> {
  const client = createEvmJsonRpcClient({ rpcUrl: input.rpcUrl });
  const latestBlock = await client.getLatestBlockNumber();
  const factoryPreset = getUniswapV3FactoryPreset(input.chain);
  const paths = getDiscoveryCachePaths(input);
  const current = await loadDiscoveryCacheState({
    chain: input.chain,
    cacheDir: input.cacheDir,
  });
  const startBlock = BigInt(current.scannedToBlock) + 1n;
  const result = await scanAndPersistPoolCreatedRows({
    client,
    chain: input.chain,
    paths,
    factoryAddress: factoryPreset.factoryAddress,
    deploymentBlock: factoryPreset.deploymentBlock,
    existingPoolAddresses: await readPoolAddressSet(paths.poolsPath),
    fromBlock: startBlock,
    toBlock: latestBlock,
    safeLatestBlock: latestBlock,
    onProgress: input.onProgress,
  });

  input.onProgress?.({
    type: "scan_done",
    foundPools: result.addedRows,
    scannedToBlock: BigInt(result.state.scannedToBlock),
  });

  return {
    state: result.state,
    rows: result.rows,
    paths,
  };
}

export async function getDiscoveryCacheStatus(input: {
  chain: DexChain;
  rpcUrl: string;
  cacheDir?: string;
}): Promise<DiscoveryCacheStatus> {
  const state = await loadDiscoveryCacheState(input);
  const client = createEvmJsonRpcClient({ rpcUrl: input.rpcUrl });
  const safeLatestBlock = await client.getLatestBlockNumber();
  const scannedToBlock = BigInt(state.scannedToBlock);

  return {
    state,
    safeLatestBlock,
    lagBlocks:
      safeLatestBlock > scannedToBlock ? safeLatestBlock - scannedToBlock : 0n,
    paths: getDiscoveryCachePaths(input),
  };
}

export async function loadDiscoveryCache(input: {
  chain: DexChain;
  cacheDir?: string;
}): Promise<{
  state: UniswapV3PoolCacheState;
  rows: UniswapV3PoolCacheRow[];
  candidates: UniswapV3PoolCandidate[];
  paths: DiscoveryCachePaths;
}> {
  const paths = getDiscoveryCachePaths(input);
  let state: UniswapV3PoolCacheState;

  try {
    state = parseState(paths.statePath, await readFile(paths.statePath, "utf8"));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`DISCOVERY_CACHE_STATE_MISSING:${input.chain}`);
    }

    throw error;
  }

  try {
    await stat(paths.poolsPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`DISCOVERY_CACHE_MISSING:${input.chain}`);
    }

    throw error;
  }

  validateStateMatchesFactory({
    chain: input.chain,
    state,
  });

  const rows = dedupeRowsByPool(await readRows(paths.poolsPath));

  return {
    state,
    rows,
    candidates: rows.map(poolCreatedRowToCandidate),
    paths,
  };
}

export function isDiscoveryCacheMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.startsWith("DISCOVERY_CACHE_MISSING:") ||
    message.startsWith("DISCOVERY_CACHE_STATE_MISSING:")
  );
}

async function loadDiscoveryCacheState(input: {
  chain: DexChain;
  cacheDir?: string;
}): Promise<UniswapV3PoolCacheState> {
  const paths = getDiscoveryCachePaths(input);
  let state: UniswapV3PoolCacheState;

  try {
    state = parseState(paths.statePath, await readFile(paths.statePath, "utf8"));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`DISCOVERY_CACHE_STATE_MISSING:${input.chain}`);
    }

    throw error;
  }

  try {
    await stat(paths.poolsPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`DISCOVERY_CACHE_MISSING:${input.chain}`);
    }

    throw error;
  }

  validateStateMatchesFactory({
    chain: input.chain,
    state,
  });

  return state;
}

async function loadDiscoveryCacheStateOrStartFresh(input: {
  chain: DexChain;
  cacheDir?: string;
}): Promise<{
  state: UniswapV3PoolCacheState | undefined;
  poolAddresses: Set<string>;
}> {
  try {
    const state = await loadDiscoveryCacheState(input);
    const paths = getDiscoveryCachePaths(input);

    return {
      state,
      poolAddresses: await readPoolAddressSet(paths.poolsPath),
    };
  } catch (error: unknown) {
    if (isDiscoveryCacheMissingError(error)) {
      return {
        state: undefined,
        poolAddresses: new Set(),
      };
    }

    throw error;
  }
}

async function scanAndPersistPoolCreatedRows(input: {
  client: EvmJsonRpcClient;
  chain: DexChain;
  paths: DiscoveryCachePaths;
  factoryAddress: `0x${string}`;
  deploymentBlock: bigint;
  existingPoolAddresses: Set<string>;
  fromBlock: bigint;
  toBlock: bigint;
  safeLatestBlock: bigint;
  onProgress?: (event: DiscoveryCacheProgressEvent) => void;
}): Promise<{
  state: UniswapV3PoolCacheState;
  rows: UniswapV3PoolCacheRow[];
  addedRows: number;
}> {
  await mkdir(dirname(input.paths.poolsPath), { recursive: true });

  if (input.existingPoolAddresses.size === 0) {
    await writeFile(input.paths.poolsPath, "", { flag: "a" });
  }

  const ranges =
    input.fromBlock <= input.toBlock
      ? planBlockRanges(
          input.fromBlock,
          input.toBlock,
          DEFAULT_FACTORY_SCAN_CHUNK_SIZE,
        )
      : [];
  const rows: UniswapV3PoolCacheRow[] = [];
  const seenPools = new Set(input.existingPoolAddresses);
  let addedRows = 0;
  let poolCount = seenPools.size;
  let scannedToBlock =
    input.fromBlock <= input.toBlock ? input.fromBlock - 1n : input.toBlock;

  input.onProgress?.({
    type: "scan_start",
    chunks: ranges.length,
    fromBlock: input.fromBlock,
    toBlock: input.toBlock,
  });

  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]!;

    input.onProgress?.({
      type: "scan_chunk",
      index: index + 1,
      total: ranges.length,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
    });

    const logs = await input.client.getLogs({
      address: input.factoryAddress,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      topics: [UNISWAP_V3_POOL_CREATED_TOPIC],
    });
    const appendRows: UniswapV3PoolCacheRow[] = [];
    for (const log of logs) {
      const row = decodeUniswapV3PoolCreatedLog(log);
      const key = row.pool.toLowerCase();

      if (seenPools.has(key)) {
        continue;
      }

      seenPools.add(key);
      appendRows.push(row);
    }

    if (appendRows.length > 0) {
      await appendFile(input.paths.poolsPath, rowsToJsonl(appendRows), "utf8");
      rows.push(...appendRows);
      addedRows += appendRows.length;
      poolCount += appendRows.length;
    }

    scannedToBlock = range.toBlock;
    await writeStateFile(
      input.paths.statePath,
      buildState({
        chain: input.chain,
        factoryAddress: input.factoryAddress,
        deploymentBlock: input.deploymentBlock,
        scannedToBlock,
        safeLatestBlock: input.safeLatestBlock,
        poolCount,
      }),
    );
  }

  const state = buildState({
    chain: input.chain,
    factoryAddress: input.factoryAddress,
    deploymentBlock: input.deploymentBlock,
    scannedToBlock:
      ranges.length > 0
        ? scannedToBlock
        : input.fromBlock > input.toBlock
          ? input.toBlock
          : input.fromBlock,
    safeLatestBlock: input.safeLatestBlock,
    poolCount,
  });

  if (ranges.length === 0) {
    await writeStateFile(input.paths.statePath, state);
  }

  return {
    state,
    rows,
    addedRows,
  };
}

function buildState(input: {
  chain: DexChain;
  factoryAddress: `0x${string}`;
  deploymentBlock: bigint;
  scannedToBlock: bigint;
  safeLatestBlock: bigint;
  poolCount: number;
}): UniswapV3PoolCacheState {
  return {
    version: CACHE_VERSION,
    chain: input.chain,
    factoryAddress: input.factoryAddress,
    deploymentBlock: input.deploymentBlock.toString(),
    scannedToBlock: input.scannedToBlock.toString(),
    safeLatestBlock: input.safeLatestBlock.toString(),
    poolCount: input.poolCount,
    updatedAt: new Date().toISOString(),
  };
}

async function writeStateFile(
  statePath: string,
  state: UniswapV3PoolCacheState,
): Promise<void> {
  const tempPath = `${statePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, statePath);
}

function parseState(path: string, raw: string): UniswapV3PoolCacheState {
  try {
    const parsed = JSON.parse(raw) as UniswapV3PoolCacheState;

    if (parsed.version !== CACHE_VERSION) {
      throw new Error("version");
    }

    return parsed;
  } catch (error: unknown) {
    throw new Error(`DISCOVERY_CACHE_STATE_INVALID:${path}`, { cause: error });
  }
}

function validateStateMatchesFactory(input: {
  chain: DexChain;
  state: UniswapV3PoolCacheState;
}): void {
  const preset = getUniswapV3FactoryPreset(input.chain);

  if (
    input.state.chain !== input.chain ||
    input.state.factoryAddress.toLowerCase() !==
      preset.factoryAddress.toLowerCase() ||
    input.state.deploymentBlock !== preset.deploymentBlock.toString()
  ) {
    throw new Error(`DISCOVERY_CACHE_FACTORY_MISMATCH:${input.chain}`);
  }
}

async function readRows(path: string): Promise<UniswapV3PoolCacheRow[]> {
  const rows: UniswapV3PoolCacheRow[] = [];
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;

    if (line.trim().length === 0) {
      continue;
    }

    rows.push(parseRowLine(line, `${path}:${lineNumber}`));
  }

  return rows;
}

async function readPoolAddressSet(path: string): Promise<Set<string>> {
  const pools = new Set<string>();
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;

    if (line.trim().length === 0) {
      continue;
    }

    pools.add(parseRowLine(line, `${path}:${lineNumber}`).pool.toLowerCase());
  }

  return pools;
}

function parseRowLine(line: string, location: string): UniswapV3PoolCacheRow {
  try {
    return validateCacheRow(JSON.parse(line) as unknown, location);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.startsWith("DISCOVERY_CACHE_STATE_INVALID:")
    ) {
      throw error;
    }

    throw new Error(`DISCOVERY_CACHE_STATE_INVALID:${location}`, {
      cause: error,
    });
  }
}

function validateCacheRow(
  value: unknown,
  location: string,
): UniswapV3PoolCacheRow {
  if (typeof value !== "object" || value === null) {
    throw new Error(`DISCOVERY_CACHE_STATE_INVALID:${location}:row`);
  }

  const row = value as Record<string, unknown>;
  assertDecimalString(row.blockNumber, location, "blockNumber");
  assertHexString(row.blockHash, location, "blockHash");
  assertHexString(row.transactionHash, location, "transactionHash");
  assertDecimalString(row.logIndex, location, "logIndex");
  assertHexString(row.token0, location, "token0");
  assertHexString(row.token1, location, "token1");
  assertInteger(row.fee, location, "fee");
  assertInteger(row.tickSpacing, location, "tickSpacing");
  assertHexString(row.pool, location, "pool");

  return row as UniswapV3PoolCacheRow;
}

function assertDecimalString(
  value: unknown,
  location: string,
  field: string,
): void {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error(`DISCOVERY_CACHE_STATE_INVALID:${location}:${field}`);
  }
}

function assertHexString(
  value: unknown,
  location: string,
  field: string,
): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`DISCOVERY_CACHE_STATE_INVALID:${location}:${field}`);
  }
}

function assertInteger(value: unknown, location: string, field: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`DISCOVERY_CACHE_STATE_INVALID:${location}:${field}`);
  }
}

function dedupeRowsByPool(
  rows: UniswapV3PoolCacheRow[],
): UniswapV3PoolCacheRow[] {
  const seen = new Set<string>();
  const deduped: UniswapV3PoolCacheRow[] = [];

  for (const row of rows) {
    const key = row.pool.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function rowsToJsonl(rows: UniswapV3PoolCacheRow[]): string {
  return rows.length > 0
    ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`
    : "";
}
