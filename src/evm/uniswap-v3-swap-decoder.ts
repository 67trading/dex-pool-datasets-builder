import type {
  DexPoolConfig,
  NormalizedPoolSwap,
} from "../types/dex-pool-dataset.types.js";
import type { EvmLog, HexString } from "./evm-json-rpc-client.js";
import { hexToBigInt, hexToNumber } from "./evm-json-rpc-client.js";
import { buildEvmOrderingKey } from "./evm-ordering-key.js";

export const UNISWAP_V3_SWAP_TOPIC =
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67" as const;

const WORD_HEX_LENGTH = 64;
const SWAP_TOPIC_COUNT = 3;
const SWAP_DATA_WORDS = 5;
const ABI_HEX_PATTERN = /^[a-fA-F0-9]+$/;
const TWO_256 = 1n << 256n;
const TWO_255 = 1n << 255n;
const Q192 = 1n << 192n;
const PRICE_SCALE = 10n ** 18n;

export function decodeUniswapV3SwapLog(input: {
  pool: DexPoolConfig;
  log: EvmLog;
  blockTimestamp: number;
}): NormalizedPoolSwap {
  if (input.pool.kind !== "UNISWAP_V3_STYLE") {
    throw new Error(`UNSUPPORTED_POOL_KIND_FOR_V3_DECODER:${input.pool.kind}`);
  }
  if (
    input.log.address.toLowerCase() !== input.pool.poolAddress.toLowerCase()
  ) {
    throw new Error(
      `UNISWAP_V3_SWAP_ADDRESS_MISMATCH:${input.pool.poolAddress}:${input.log.address}:${input.log.transactionHash}:${input.log.logIndex}`,
    );
  }
  if (input.log.topics.length !== SWAP_TOPIC_COUNT) {
    throw new Error(
      `UNISWAP_V3_SWAP_TOPIC_COUNT_INVALID:${input.log.transactionHash}:${input.log.logIndex}:${input.log.topics.length}`,
    );
  }
  if (input.log.topics[0]?.toLowerCase() !== UNISWAP_V3_SWAP_TOPIC) {
    throw new Error(
      `UNISWAP_V3_SWAP_TOPIC_MISMATCH:${input.log.transactionHash}:${input.log.logIndex}`,
    );
  }
  assertSwapDataShape(
    input.log.data,
    input.log.transactionHash,
    input.log.logIndex,
  );

  const amount0Raw = decodeSignedWord(input.log.data, 0);
  const amount1Raw = decodeSignedWord(input.log.data, 1);
  const sqrtPriceX96 = decodeUnsignedWord(input.log.data, 2);
  const liquidity = decodeUnsignedWord(input.log.data, 3);
  const tick = Number(decodeSignedWord(input.log.data, 4));
  const priceToken1PerToken0 = sqrtPriceX96ToAdjustedPrice({
    sqrtPriceX96,
    token0Decimals: input.pool.token0.decimals,
    token1Decimals: input.pool.token1.decimals,
  });

  if (!Number.isFinite(priceToken1PerToken0) || priceToken1PerToken0 <= 0) {
    throw new Error(
      `UNISWAP_V3_INVALID_PRICE:${input.log.transactionHash}:${input.log.logIndex}`,
    );
  }

  return {
    chain: input.pool.chain,
    dex: input.pool.dex,
    poolAddress: input.pool.poolAddress,
    orderingKey: buildEvmOrderingKey({
      blockNumber: hexToBigInt(input.log.blockNumber),
      transactionIndex: hexToNumber(input.log.transactionIndex),
      logIndex: hexToNumber(input.log.logIndex),
    }),
    txRef: input.log.transactionHash,
    blockTimestamp: input.blockTimestamp,
    token0Symbol: input.pool.token0.symbol,
    token1Symbol: input.pool.token1.symbol,
    amount0: formatUnitsToNumber(amount0Raw, input.pool.token0.decimals),
    amount1: formatUnitsToNumber(amount1Raw, input.pool.token1.decimals),
    amount0Raw: amount0Raw.toString(),
    amount1Raw: amount1Raw.toString(),
    token0Decimals: input.pool.token0.decimals,
    token1Decimals: input.pool.token1.decimals,
    priceToken1PerToken0,
    priceToken0PerToken1: 1 / priceToken1PerToken0,
    sqrtPriceX96Raw: sqrtPriceX96.toString(),
    liquidityAfter: liquidity.toString(),
    tickAfter: tick,
    attributionMode: "EXACT_LOG_DECODE",
    raw: input.log,
  };
}

export function sqrtPriceX96ToAdjustedPrice(input: {
  sqrtPriceX96: bigint;
  token0Decimals: number;
  token1Decimals: number;
}): number {
  const numerator = input.sqrtPriceX96 * input.sqrtPriceX96;
  const decimalDelta = input.token0Decimals - input.token1Decimals;
  const scaled =
    decimalDelta >= 0
      ? (numerator * PRICE_SCALE * pow10(decimalDelta)) / Q192
      : (numerator * PRICE_SCALE) / (Q192 * pow10(-decimalDelta));
  return Number(scaled) / Number(PRICE_SCALE);
}

export function formatUnitsToNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

function decodeUnsignedWord(data: HexString, wordIndex: number): bigint {
  return BigInt(`0x${readWord(data, wordIndex)}`);
}

function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new Error(`INVALID_DECIMAL_EXPONENT:${exponent}`);
  }
  return 10n ** BigInt(exponent);
}

function decodeSignedWord(data: HexString, wordIndex: number): bigint {
  const unsigned = decodeUnsignedWord(data, wordIndex);
  return unsigned >= TWO_255 ? unsigned - TWO_256 : unsigned;
}

function readWord(data: HexString, wordIndex: number): string {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const start = wordIndex * WORD_HEX_LENGTH;
  const end = start + WORD_HEX_LENGTH;
  const word = hex.slice(start, end);
  if (word.length !== WORD_HEX_LENGTH) {
    throw new Error(`ABI_WORD_MISSING:${wordIndex}`);
  }
  return word;
}

function assertSwapDataShape(
  data: HexString,
  transactionHash: string,
  logIndex: HexString,
): void {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (!ABI_HEX_PATTERN.test(hex)) {
    throw new Error(
      `UNISWAP_V3_SWAP_DATA_INVALID_HEX:${transactionHash}:${logIndex}`,
    );
  }
  const expectedLength = SWAP_DATA_WORDS * WORD_HEX_LENGTH;
  if (hex.length !== expectedLength) {
    throw new Error(
      `UNISWAP_V3_SWAP_DATA_LENGTH_INVALID:${transactionHash}:${logIndex}:${hex.length}`,
    );
  }
}
