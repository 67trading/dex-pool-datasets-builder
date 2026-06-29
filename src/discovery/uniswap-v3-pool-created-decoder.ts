import {
  hexToBigInt,
  hexToNumber,
  type EvmLog,
  type HexString,
} from "../evm/evm-json-rpc-client.js";
import type {
  UniswapV3PoolCacheRow,
  UniswapV3PoolCandidate,
} from "./discovery.types.js";
import {
  decodeAddressAbiWord,
  decodeSignedAbiWord,
  readAbiWord,
} from "./abi-word-decoder.js";

export const UNISWAP_V3_POOL_CREATED_TOPIC =
  "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118" as const;

export function decodeUniswapV3PoolCreatedLog(
  log: EvmLog,
): UniswapV3PoolCacheRow {
  try {
    if (log.topics[0]?.toLowerCase() !== UNISWAP_V3_POOL_CREATED_TOPIC) {
      throw new Error("topic");
    }

    if (log.topics.length !== 4) {
      throw new Error("topic_count");
    }

    return {
      blockNumber: hexToBigInt(log.blockNumber).toString(),
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      logIndex: hexToNumber(log.logIndex).toString(),
      token0: decodeTopicAddress(log.topics[1]!, "token0"),
      token1: decodeTopicAddress(log.topics[2]!, "token1"),
      fee: Number(hexToBigInt(log.topics[3]!)),
      tickSpacing: Number(decodeSignedAbiWord(log.data, 0)),
      pool: decodeDataAddress(log.data, 1, "pool"),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DISCOVERY_POOL_CREATED_LOG_INVALID:${message}`);
  }
}

export function poolCreatedRowToCandidate(
  row: UniswapV3PoolCacheRow,
): UniswapV3PoolCandidate {
  return {
    token0: row.token0,
    token1: row.token1,
    feeTier: row.fee,
    poolAddress: row.pool,
  };
}

function decodeTopicAddress(topic: HexString, field: string): HexString {
  return decodeAddressAbiWord(strip0x(topic), field);
}

function decodeDataAddress(
  data: HexString,
  wordIndex: number,
  field: string,
): HexString {
  return decodeAddressAbiWord(readAbiWord(data, wordIndex), field);
}

function strip0x(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}
