import type {
  EvmJsonRpcClient,
  HexString,
} from "../evm/evm-json-rpc-client.js";
import type { DexChain } from "../types/dex-pool-dataset.types.js";
import { assertEvmAddress, isZeroAddress } from "./evm-address.js";
import { getLiquidPairPreset, normalizePair } from "./liquid-pair-presets.js";
import type {
  DexPoolSelectionMetadata,
  PoolSelectionResolvedBy,
} from "./pool-selection-metadata.types.js";
import { resolveTokenPreset } from "./token-presets.js";
import { getUniswapV3FactoryAddress } from "./uniswap-v3-factory-presets.js";

const SELECTOR_GET_POOL = "0x1698ee82" as const;

export type PoolSelectionResolution = {
  poolAddress: HexString;
  resolvedBy: PoolSelectionResolvedBy;

  base?: string;
  quote?: string;

  pair?: string;
  fee?: number;
  presetFee?: number;

  token0?: HexString;
  token1?: HexString;
  factoryAddress?: HexString;

  metadata: DexPoolSelectionMetadata;
};

export async function resolvePoolSelection(input: {
  client: EvmJsonRpcClient;
  chain: DexChain;

  /**
   * Direct pool contract address.
   *
   * Highest-priority selector.
   */
  pool?: string;

  /**
   * Pair selector.
   *
   * Example:
   * WETH/USDC
   */
  pair?: string;

  /**
   * Uniswap v3 fee tier.
   *
   * Examples:
   * 100, 500, 3000, 10000
   */
  fee?: number | string;

  /**
   * Token address selectors for factory.getPool(token0, token1, fee).
   */
  token0?: string;
  token1?: string;

  /**
   * Optional base/quote selectors used when the final pool metadata is read.
   */
  base?: string;
  quote?: string;
}): Promise<PoolSelectionResolution> {
  if (input.pool !== undefined && input.pool.length > 0) {
    const poolAddress = assertEvmAddress(input.pool, "pool");

    return {
      poolAddress,
      resolvedBy: "direct_pool",
      base: input.base,
      quote: input.quote,
      metadata: {
        resolvedBy: "direct_pool",
        inputPoolAddress: poolAddress,
        resolvedPoolAddress: poolAddress,
      },
    };
  }

  if (input.token0 !== undefined || input.token1 !== undefined) {
    if (input.token0 === undefined || input.token1 === undefined) {
      throw new Error("SIMPLE_TOKEN0_TOKEN1_REQUIRED_TOGETHER");
    }

    const fee = normalizeFee(input.fee);
    const token0 = assertEvmAddress(input.token0, "token0");
    const token1 = assertEvmAddress(input.token1, "token1");
    const factoryAddress = getUniswapV3FactoryAddress(input.chain);

    const poolAddress = await getPoolFromFactory({
      client: input.client,
      chain: input.chain,
      token0,
      token1,
      fee,
    });

    return {
      poolAddress,
      resolvedBy: "factory_getPool",
      token0,
      token1,
      fee,
      factoryAddress,
      base: input.base,
      quote: input.quote,
      metadata: {
        resolvedBy: "factory_getPool",
        inputFee: fee,
        factoryAddress,
        token0,
        token1,
        resolvedPoolAddress: poolAddress,
      },
    };
  }

  if (input.pair !== undefined && input.pair.length > 0) {
    const normalizedPair = normalizePair(input.pair);
    const [baseSymbol, quoteSymbol] = normalizedPair.split("/") as [
      string,
      string,
    ];

    const preset =
      input.fee === undefined
        ? getLiquidPairPreset({
            chain: input.chain,
            pair: normalizedPair,
          })
        : undefined;

    const fee = normalizeFee(input.fee ?? preset?.fee);

    const baseToken = resolveTokenPreset({
      chain: input.chain,
      selector: baseSymbol,
    });

    const quoteToken = resolveTokenPreset({
      chain: input.chain,
      selector: quoteSymbol,
    });

    const factoryAddress = getUniswapV3FactoryAddress(input.chain);
    const token0Address = assertEvmAddress(baseToken.address, "token0");
    const token1Address = assertEvmAddress(quoteToken.address, "token1");

    const poolAddress = await getPoolFromFactory({
      client: input.client,
      chain: input.chain,
      token0: token0Address,
      token1: token1Address,
      fee,
    });

    const resolvedBy: PoolSelectionResolvedBy =
      preset !== undefined && input.fee === undefined
        ? "liquid_pair_preset"
        : "factory_getPool";

    return {
      poolAddress,
      resolvedBy,
      pair: normalizedPair,
      fee,
      presetFee: preset?.fee,
      token0: token0Address,
      token1: token1Address,
      factoryAddress,
      base: baseSymbol,
      quote: quoteSymbol,
      metadata: {
        resolvedBy,
        inputPair: normalizedPair,
        inputFee: input.fee !== undefined ? fee : undefined,
        presetFee:
          preset !== undefined && input.fee === undefined
            ? preset.fee
            : undefined,
        factoryAddress,
        token0: token0Address,
        token1: token1Address,
        resolvedPoolAddress: poolAddress,
      },
    };
  }

  throw new Error(
    "SIMPLE_POOL_SELECTION_REQUIRED: pass --pool, --pair, or --token0/--token1/--fee",
  );
}

function normalizeFee(value: number | string | undefined): number {
  if (value === undefined) {
    throw new Error("SIMPLE_FEE_REQUIRED");
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`SIMPLE_FEE_INVALID:${String(value)}`);
  }

  return parsed;
}

async function getPoolFromFactory(input: {
  client: EvmJsonRpcClient;
  chain: DexChain;
  token0: HexString;
  token1: HexString;
  fee: number;
}): Promise<HexString> {
  const factory = getUniswapV3FactoryAddress(input.chain);
  const data = encodeGetPoolCall(input.token0, input.token1, input.fee);

  const result = await input.client.call({
    to: factory,
    data,
  });

  const poolAddress = decodeAddress(result);

  if (isZeroAddress(poolAddress)) {
    throw new Error(
      `SIMPLE_POOL_NOT_FOUND:${input.chain}:${input.token0}:${input.token1}:${input.fee}`,
    );
  }

  return poolAddress;
}

function encodeGetPoolCall(
  token0: HexString,
  token1: HexString,
  fee: number,
): HexString {
  return `0x${SELECTOR_GET_POOL.slice(2)}${encodeAddress(token0)}${encodeAddress(
    token1,
  )}${encodeUint24(fee)}` as HexString;
}

function encodeAddress(address: HexString): string {
  return address.toLowerCase().slice(2).padStart(64, "0");
}

function encodeUint24(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new Error(`ABI_UINT24_INVALID:${value}`);
  }

  return value.toString(16).padStart(64, "0");
}

function decodeAddress(value: HexString): HexString {
  const hex = value.startsWith("0x") ? value.slice(2) : value;

  if (hex.length < 64) {
    throw new Error(`ABI_ADDRESS_RESULT_INVALID:${value}`);
  }

  return `0x${hex.slice(-40)}` as HexString;
}
