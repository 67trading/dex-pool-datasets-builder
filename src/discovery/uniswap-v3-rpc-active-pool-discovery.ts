import {
  createEvmJsonRpcClient,
  hexToNumber,
  type EvmJsonRpcClient,
} from "../evm/evm-json-rpc-client.js";
import { planBlockRanges } from "../evm/block-range-planner.js";
import { UNISWAP_V3_SWAP_TOPIC } from "../evm/uniswap-v3-swap-decoder.js";
import { getUniswapV3FactoryPreset } from "../simple/uniswap-v3-factory-presets.js";
import { readUniswapV3PoolConfig } from "../simple/evm-contract-reader.js";
import { resolveTokenPreset } from "../simple/token-presets.js";
import type {
  DexChain,
  DexPoolConfig,
  DexPoolToken,
} from "../types/dex-pool-dataset.types.js";
import type {
  DiscoveredDexPool,
  DiscoveryMetric,
  UniswapV3PoolCandidate,
  UniswapV3RpcDiscoveryProgressEvent,
  UniswapV3RpcDiscoveryInput,
} from "./discovery.types.js";
import { decodeUniswapV3SwapAmounts } from "./uniswap-v3-swap-amount-decoder.js";

const DEFAULT_SWAP_SCAN_CHUNK_SIZE = 5_000n;

type PoolScore = {
  candidate: UniswapV3PoolCandidate;
  swapCount: number;
  quoteVolumeRaw: bigint;
};

type LookbackBlockRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

export async function discoverTopUniswapV3Pools(
  input: UniswapV3RpcDiscoveryInput,
): Promise<DiscoveredDexPool[]> {
  const metric = normalizeDiscoveryMetric(input.top.by);
  const limit = normalizeLimit(input.top.limit);
  const lookbackDays = normalizeLookbackDays(input.top.lookbackDays);
  const factoryPreset = getUniswapV3FactoryPreset(input.chain);
  const client = createEvmJsonRpcClient({ rpcUrl: input.rpcUrl });
  const quoteToken =
    metric === "quoteVolume"
      ? resolveQuoteToken({ chain: input.chain, quote: input.quote })
      : undefined;
  const latestBlock = await client.getLatestBlockNumber();
  const lookbackRange = await resolveLookbackBlockRange({
    client,
    latestBlock,
    lookbackDays,
  });
  input.onResolvedRange?.({
    latestBlock: latestBlock.toString(),
    fromBlock: lookbackRange.fromBlock.toString(),
    toBlock: lookbackRange.toBlock.toString(),
  });
  const scored = await scorePoolCandidates({
    client,
    candidates:
      quoteToken === undefined
        ? input.candidates
        : input.candidates.filter((candidate) =>
            candidateContainsQuoteToken(candidate, quoteToken),
          ),
    metric,
    quoteToken,
    fromBlock: lookbackRange.fromBlock,
    toBlock: lookbackRange.toBlock,
    onProgress: input.onProgress,
  });
  const topScores = scored
    .filter((score) => score.swapCount > 0)
    .sort((a, b) => compareScores(a, b, metric))
    .slice(0, limit);
  const snapshotAt = new Date().toISOString();
  const discovered: DiscoveredDexPool[] = [];

  for (let index = 0; index < topScores.length; index += 1) {
    const score = topScores[index]!;
    const pool = await readUniswapV3PoolConfig({
      client,
      chain: input.chain,
      poolAddress: score.candidate.poolAddress,
      startBlock: factoryPreset.deploymentBlock.toString(),
      quote: quoteToken?.symbol,
    });
    const rank = index + 1;
    const metricValue =
      metric === "swapCount"
        ? String(score.swapCount)
        : formatUnits(score.quoteVolumeRaw, quoteToken!.decimals);

    discovered.push({
      rank,
      pool,
      metric,
      metricValue,
      discovery: {
        source: "uniswap_v3_rpc",
        snapshotAt,
        rank,
        metric,
        metricValue,
        poolAddress: score.candidate.poolAddress,
        feeTier: score.candidate.feeTier,
        pair: `${pool.token0.symbol}/${pool.token1.symbol}`,
        swapCount: score.swapCount,
        quoteSymbol: quoteToken?.symbol,
        quoteVolume:
          quoteToken === undefined
            ? undefined
            : formatUnits(score.quoteVolumeRaw, quoteToken.decimals),
        factoryAddress: factoryPreset.factoryAddress,
        factoryDeploymentBlock: factoryPreset.deploymentBlock.toString(),
        fromBlock: lookbackRange.fromBlock.toString(),
        toBlock: lookbackRange.toBlock.toString(),
      },
    });
  }

  return discovered;
}

export function normalizeDiscoveryMetric(metric: string): DiscoveryMetric {
  if (metric === "swapCount" || metric === "quoteVolume") {
    return metric;
  }

  throw new Error(`DISCOVERY_METRIC_INVALID:${metric}`);
}

async function scorePoolCandidates(input: {
  client: EvmJsonRpcClient;
  candidates: UniswapV3PoolCandidate[];
  metric: DiscoveryMetric;
  quoteToken: DexPoolToken | undefined;
  fromBlock: bigint;
  toBlock: bigint;
  onProgress?: (event: UniswapV3RpcDiscoveryProgressEvent) => void;
}): Promise<PoolScore[]> {
  const scoreByPool = new Map<string, PoolScore>();
  const candidateByAddress = new Map(
    input.candidates.map((candidate) => [
      candidate.poolAddress.toLowerCase(),
      candidate,
    ]),
  );
  const ranges = planBlockRanges(
    input.fromBlock,
    input.toBlock,
    DEFAULT_SWAP_SCAN_CHUNK_SIZE,
  );

  for (const candidate of input.candidates) {
    scoreByPool.set(candidate.poolAddress.toLowerCase(), {
      candidate,
      swapCount: 0,
      quoteVolumeRaw: 0n,
    });
  }

  input.onProgress?.({
    type: "score_start",
    candidateCount: input.candidates.length,
    batches: 1,
    ranges: ranges.length,
    fromBlock: input.fromBlock.toString(),
    toBlock: input.toBlock.toString(),
  });

  input.onProgress?.({
    type: "score_batch",
    batchIndex: 1,
    batchTotal: 1,
    addressCount: input.candidates.length,
  });

  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
    const range = ranges[rangeIndex]!;

    input.onProgress?.({
      type: "score_range",
      batchIndex: 1,
      batchTotal: 1,
      rangeIndex: rangeIndex + 1,
      rangeTotal: ranges.length,
      fromBlock: range.fromBlock.toString(),
      toBlock: range.toBlock.toString(),
    });

    const logs = await input.client.getLogs({
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      topics: [UNISWAP_V3_SWAP_TOPIC],
    });

    for (const log of logs) {
      const key = log.address.toLowerCase();
      const candidate = candidateByAddress.get(key);
      const score = scoreByPool.get(key);

      if (candidate === undefined || score === undefined) {
        continue;
      }

      score.swapCount += 1;

      if (input.metric === "quoteVolume") {
        const amounts = decodeUniswapV3SwapAmounts(log.data);
        const quoteAmountRaw =
          input.quoteToken!.address.toLowerCase() ===
          candidate.token0.toLowerCase()
            ? amounts.amount0
            : amounts.amount1;
        score.quoteVolumeRaw += abs(quoteAmountRaw);
      }
    }
  }

  input.onProgress?.({
    type: "score_done",
    candidateCount: input.candidates.length,
    scoredPools: [...scoreByPool.values()].filter((score) => score.swapCount > 0)
      .length,
  });

  return [...scoreByPool.values()];
}

async function resolveLookbackBlockRange(input: {
  client: EvmJsonRpcClient;
  latestBlock: bigint;
  lookbackDays: number;
}): Promise<LookbackBlockRange> {
  const latest = await input.client.getBlockByNumber(input.latestBlock);
  const latestTimestamp = hexToNumber(latest.timestamp);
  const targetTimestamp = latestTimestamp - input.lookbackDays * 24 * 60 * 60;
  const fromBlock = await findFirstBlockAtOrAfter({
    latestBlock: input.latestBlock,
    targetTimestamp,
    getTimestamp: async (blockNumber) => {
      const block = await input.client.getBlockByNumber(blockNumber);
      return hexToNumber(block.timestamp);
    },
  });

  return {
    fromBlock,
    toBlock: input.latestBlock,
  };
}

async function findFirstBlockAtOrAfter(input: {
  latestBlock: bigint;
  targetTimestamp: number;
  getTimestamp: (blockNumber: bigint) => Promise<number>;
}): Promise<bigint> {
  let low = 0n;
  let high = input.latestBlock;

  while (low < high) {
    const mid = (low + high) / 2n;
    const timestamp = await input.getTimestamp(mid);

    if (timestamp >= input.targetTimestamp) {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }

  return low;
}

function resolveQuoteToken(input: {
  chain: DexChain;
  quote: string | undefined;
}): DexPoolToken {
  if (input.quote === undefined || input.quote.length === 0) {
    throw new Error(
      "DISCOVERY_QUOTE_REQUIRED: --quote is required when --by quoteVolume",
    );
  }

  try {
    return resolveTokenPreset({
      chain: input.chain,
      selector: input.quote,
    });
  } catch {
    throw new Error(
      `DISCOVERY_QUOTE_TOKEN_NOT_FOUND:${input.chain}:${input.quote}`,
    );
  }
}

function candidateContainsQuoteToken(
  candidate: UniswapV3PoolCandidate,
  quoteToken: DexPoolToken,
): boolean {
  const quoteAddress = quoteToken.address.toLowerCase();
  return (
    candidate.token0.toLowerCase() === quoteAddress ||
    candidate.token1.toLowerCase() === quoteAddress
  );
}

function compareScores(
  left: PoolScore,
  right: PoolScore,
  metric: DiscoveryMetric,
): number {
  if (metric === "quoteVolume" && left.quoteVolumeRaw !== right.quoteVolumeRaw) {
    return left.quoteVolumeRaw > right.quoteVolumeRaw ? -1 : 1;
  }

  if (left.swapCount !== right.swapCount) {
    return right.swapCount - left.swapCount;
  }

  return left.candidate.poolAddress.localeCompare(right.candidate.poolAddress);
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`DISCOVERY_TOP_INVALID:${limit}`);
  }

  return limit;
}

function normalizeLookbackDays(days: number): number {
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`DISCOVERY_LOOKBACK_DAYS_INVALID:${days}`);
  }

  return days;
}

function formatUnits(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  const fractionText = fraction.toString().padStart(decimals, "0");
  const trimmed = fractionText.replace(/0+$/g, "");

  return trimmed.length > 0 ? `${whole.toString()}.${trimmed}` : whole.toString();
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
