import { Buffer } from "node:buffer";
import type {
  DexChain,
  DexPoolConfig,
  DexPoolToken,
  DexTokenRef,
} from "../types/dex-pool-dataset.types.js";
import type {
  EvmJsonRpcClient,
  HexString,
} from "../evm/evm-json-rpc-client.js";
import {
  SIMPLE_SUPPORTED_DEX,
  SIMPLE_SUPPORTED_POOL_KIND,
} from "./simple-dex.constants.js";

const SELECTOR_TOKEN0 = "0x0dfe1681" as const;
const SELECTOR_TOKEN1 = "0xd21220a7" as const;
const SELECTOR_FEE = "0xddca3f43" as const;
const SELECTOR_SYMBOL = "0x95d89b41" as const;
const SELECTOR_DECIMALS = "0x313ce567" as const;

export async function readUniswapV3PoolConfig(input: {
  client: EvmJsonRpcClient;
  chain: DexChain;
  poolAddress: HexString;
  startBlock: string;
  base?: string;
  quote?: string;
}): Promise<DexPoolConfig> {
  const token0Address = await callAddress(
    input.client,
    input.poolAddress,
    SELECTOR_TOKEN0,
  );
  const token1Address = await callAddress(
    input.client,
    input.poolAddress,
    SELECTOR_TOKEN1,
  );
  const feeTier = Number(
    await callUint(input.client, input.poolAddress, SELECTOR_FEE),
  );

  const token0 = await readToken(input.client, token0Address);
  const token1 = await readToken(input.client, token1Address);

  const { baseToken, quoteToken } = resolveBaseQuoteRefs({
    token0,
    token1,
    base: input.base,
    quote: input.quote,
  });

  const baseSymbol = baseToken === "token0" ? token0.symbol : token1.symbol;
  const quoteSymbol = quoteToken === "token0" ? token0.symbol : token1.symbol;

  return {
    id: buildGeneratedPoolId({
      chain: input.chain,
      baseSymbol,
      quoteSymbol,
      feeTier,
      poolAddress: input.poolAddress,
    }),
    chain: input.chain,
    dex: SIMPLE_SUPPORTED_DEX,
    kind: SIMPLE_SUPPORTED_POOL_KIND,
    poolAddress: input.poolAddress,
    token0,
    token1,
    baseToken,
    quoteToken,
    feeTier,
    startBlock: input.startBlock,
  };
}

async function readToken(
  client: EvmJsonRpcClient,
  address: HexString,
): Promise<DexPoolToken> {
  const decimals = Number(await callUint(client, address, SELECTOR_DECIMALS));

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`TOKEN_DECIMALS_UNSUPPORTED:${address}:${decimals}`);
  }

  const symbol = await callString(client, address, SELECTOR_SYMBOL).catch(
    () => {
      return `TOKEN_${address.slice(2, 8).toUpperCase()}`;
    },
  );

  return {
    address,
    symbol,
    decimals,
  };
}

async function callAddress(
  client: EvmJsonRpcClient,
  to: HexString,
  data: HexString,
): Promise<HexString> {
  const result = strip0x(await client.call({ to, data }));

  if (result.length < 64) {
    throw new Error(`EVM_CALL_ADDRESS_RESULT_INVALID:${to}:${data}`);
  }

  return `0x${result.slice(-40)}` as HexString;
}

async function callUint(
  client: EvmJsonRpcClient,
  to: HexString,
  data: HexString,
): Promise<bigint> {
  const result = strip0x(await client.call({ to, data }));

  if (result.length < 64) {
    throw new Error(`EVM_CALL_UINT_RESULT_INVALID:${to}:${data}`);
  }

  return BigInt(`0x${result.slice(0, 64)}`);
}

async function callString(
  client: EvmJsonRpcClient,
  to: HexString,
  data: HexString,
): Promise<string> {
  const result = strip0x(await client.call({ to, data }));
  const decoded = decodeAbiStringOrBytes32(result);

  if (decoded.length === 0) {
    throw new Error(`EVM_CALL_STRING_EMPTY:${to}:${data}`);
  }

  return decoded;
}

function decodeAbiStringOrBytes32(hexWithoutPrefix: string): string {
  if (hexWithoutPrefix.length === 64) {
    return decodeHexString(hexWithoutPrefix).replace(/\0+$/g, "").trim();
  }

  if (hexWithoutPrefix.length < 128) {
    throw new Error(`ABI_STRING_RESULT_TOO_SHORT:${hexWithoutPrefix.length}`);
  }

  const offset = Number(BigInt(`0x${hexWithoutPrefix.slice(0, 64)}`));
  const lengthStart = offset * 2;
  const lengthWord = hexWithoutPrefix.slice(lengthStart, lengthStart + 64);
  const length = Number(BigInt(`0x${lengthWord}`));

  const dataStart = lengthStart + 64;
  const dataEnd = dataStart + length * 2;

  if (dataEnd > hexWithoutPrefix.length) {
    throw new Error(
      `ABI_STRING_RESULT_LENGTH_INVALID:${length}:${hexWithoutPrefix.length}`,
    );
  }

  return decodeHexString(hexWithoutPrefix.slice(dataStart, dataEnd)).trim();
}

function decodeHexString(hex: string): string {
  return Buffer.from(hex, "hex").toString("utf8");
}

function resolveBaseQuoteRefs(input: {
  token0: DexPoolToken;
  token1: DexPoolToken;
  base?: string;
  quote?: string;
}): { baseToken: DexTokenRef; quoteToken: DexTokenRef } {
  const baseToken =
    input.base !== undefined
      ? matchTokenRef(input.base, input.token0, input.token1)
      : undefined;

  const quoteToken =
    input.quote !== undefined
      ? matchTokenRef(input.quote, input.token0, input.token1)
      : undefined;

  if (baseToken !== undefined && quoteToken !== undefined) {
    if (baseToken === quoteToken) {
      throw new Error(`SIMPLE_BASE_QUOTE_SAME:${input.base}:${input.quote}`);
    }

    return { baseToken, quoteToken };
  }

  if (baseToken !== undefined) {
    return {
      baseToken,
      quoteToken: baseToken === "token0" ? "token1" : "token0",
    };
  }

  if (quoteToken !== undefined) {
    return {
      baseToken: quoteToken === "token0" ? "token1" : "token0",
      quoteToken,
    };
  }

  return {
    baseToken: "token0",
    quoteToken: "token1",
  };
}

function matchTokenRef(
  selector: string,
  token0: DexPoolToken,
  token1: DexPoolToken,
): DexTokenRef {
  const normalized = selector.toLowerCase();

  const token0Matches =
    token0.address.toLowerCase() === normalized ||
    token0.symbol.toLowerCase() === normalized;

  const token1Matches =
    token1.address.toLowerCase() === normalized ||
    token1.symbol.toLowerCase() === normalized;

  if (token0Matches && token1Matches) {
    throw new Error(`SIMPLE_TOKEN_SELECTOR_AMBIGUOUS:${selector}`);
  }

  if (token0Matches) {
    return "token0";
  }

  if (token1Matches) {
    return "token1";
  }

  throw new Error(
    `SIMPLE_TOKEN_SELECTOR_NOT_FOUND:${selector}:${token0.symbol}:${token1.symbol}`,
  );
}

function buildGeneratedPoolId(input: {
  chain: DexChain;
  baseSymbol: string;
  quoteSymbol: string;
  feeTier: number;
  poolAddress: HexString;
}): string {
  return [
    input.chain,
    sanitizeIdPart(SIMPLE_SUPPORTED_DEX),
    sanitizeIdPart(input.baseSymbol),
    sanitizeIdPart(input.quoteSymbol),
    String(input.feeTier),
    input.poolAddress.slice(2, 10).toLowerCase(),
  ].join("-");
}

function sanitizeIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function strip0x(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}
