import type { DexPoolConfig } from "../types/dex-pool-dataset.types.js";
import { isSolanaAddress } from "../solana/solana-address.js";

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export type PoolRegistryValidationResult = {
  pools: DexPoolConfig[];
  errors: string[];
};

export function validatePoolRegistry(
  input: unknown,
): PoolRegistryValidationResult {
  if (!Array.isArray(input)) {
    return { pools: [], errors: ["POOL_REGISTRY_NOT_ARRAY"] };
  }

  const errors: string[] = [];
  const ids = new Set<string>();
  const pools: DexPoolConfig[] = [];

  input.forEach((entry, index) => {
    const entryErrors: string[] = [];
    if (!isRecord(entry)) {
      errors.push(`POOL_REGISTRY_ENTRY_NOT_OBJECT:${index}`);
      return;
    }

    const pool = entry as Partial<DexPoolConfig>;
    const context = String(pool.id ?? index);
    const requiredStringFields = [
      "id",
      "chain",
      "dex",
      "kind",
      "poolAddress",
      "startBlock",
    ] as const;
    for (const field of requiredStringFields) {
      if (typeof pool[field] !== "string" || pool[field].length === 0) {
        entryErrors.push(`POOL_FIELD_MISSING:${context}:${field}`);
      }
    }

    if (typeof pool.id === "string") {
      if (ids.has(pool.id)) {
        entryErrors.push(`POOL_ID_DUPLICATE:${pool.id}`);
      }
      ids.add(pool.id);
    }

    if (
      pool.kind !== undefined &&
      pool.kind !== "UNISWAP_V3_STYLE" &&
      pool.kind !== "UNISWAP_V2_STYLE" &&
      pool.kind !== "SOLANA_AMM_STYLE"
    ) {
      entryErrors.push(`POOL_KIND_UNSUPPORTED:${context}:${String(pool.kind)}`);
    }
    if (pool.kind === "UNISWAP_V2_STYLE") {
      entryErrors.push(`POOL_KIND_NOT_MVP:${context}:UNISWAP_V2_STYLE`);
    }
    if (
      pool.kind === "SOLANA_AMM_STYLE" &&
      (typeof pool.programId !== "string" || pool.programId.length === 0)
    ) {
      entryErrors.push(`POOL_PROGRAM_ID_MISSING:${context}`);
    }

    const addressChain = pool.chain === "solana" ? "solana" : "evm";

    validateAddress(
      pool.poolAddress,
      addressChain,
      `POOL_ADDRESS_INVALID:${context}:poolAddress`,
      entryErrors,
    );
    validateToken(pool.token0, addressChain, `${context}:token0`, entryErrors);
    validateToken(pool.token1, addressChain, `${context}:token1`, entryErrors);

    if (pool.baseToken !== "token0" && pool.baseToken !== "token1") {
      entryErrors.push(`POOL_BASE_TOKEN_INVALID:${context}`);
    }
    if (pool.quoteToken !== "token0" && pool.quoteToken !== "token1") {
      entryErrors.push(`POOL_QUOTE_TOKEN_INVALID:${context}`);
    }
    if (
      pool.baseToken !== undefined &&
      pool.quoteToken !== undefined &&
      pool.baseToken === pool.quoteToken
    ) {
      entryErrors.push(`POOL_BASE_QUOTE_SAME:${context}`);
    }
    if (pool.startBlock !== undefined && !isIntegerString(pool.startBlock)) {
      entryErrors.push(`POOL_START_BLOCK_INVALID:${context}`);
    }
    if (pool.endBlock !== undefined && !isIntegerString(pool.endBlock)) {
      entryErrors.push(`POOL_END_BLOCK_INVALID:${context}`);
    }

    errors.push(...entryErrors);
    if (entryErrors.length === 0) {
      pools.push(pool as DexPoolConfig);
    }
  });

  return { pools, errors };
}

export function buildReplaySymbol(pool: DexPoolConfig): string {
  const base = pool[pool.baseToken].symbol.toUpperCase();
  const quote = pool[pool.quoteToken].symbol.toUpperCase();
  return `${base}${quote}`;
}

type RegistryAddressChain = "evm" | "solana";

function validateToken(
  token: unknown,
  addressChain: RegistryAddressChain,
  context: string,
  errors: string[],
): void {
  if (!isRecord(token)) {
    errors.push(`POOL_TOKEN_INVALID:${context}`);
    return;
  }
  if (typeof token.symbol !== "string" || token.symbol.length === 0) {
    errors.push(`POOL_TOKEN_SYMBOL_MISSING:${context}`);
  }
  validateAddress(
    token.address,
    addressChain,
    `POOL_TOKEN_ADDRESS_INVALID:${context}`,
    errors,
  );
  if (
    typeof token.decimals !== "number" ||
    !Number.isInteger(token.decimals) ||
    token.decimals < 0 ||
    token.decimals > 36
  ) {
    errors.push(`POOL_TOKEN_DECIMALS_INVALID:${context}`);
  }
}

function validateAddress(
  value: unknown,
  addressChain: RegistryAddressChain,
  errorCode: string,
  errors: string[],
): void {
  if (typeof value !== "string") {
    errors.push(errorCode);
    return;
  }
  const valid =
    addressChain === "solana"
      ? isSolanaAddress(value)
      : EVM_ADDRESS_PATTERN.test(value);
  if (!valid) {
    errors.push(errorCode);
  }
}

function isIntegerString(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
