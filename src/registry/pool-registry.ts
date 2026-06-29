import type { DexPoolConfig } from "../types/dex-pool-dataset.types.js";

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
      pool.kind !== "UNISWAP_V2_STYLE"
    ) {
      entryErrors.push(`POOL_KIND_UNSUPPORTED:${context}:${String(pool.kind)}`);
    }
    if (pool.kind === "UNISWAP_V2_STYLE") {
      entryErrors.push(`POOL_KIND_NOT_MVP:${context}:UNISWAP_V2_STYLE`);
    }

    validateAddress(
      pool.poolAddress,
      `POOL_ADDRESS_INVALID:${context}:poolAddress`,
      entryErrors,
    );
    validateToken(pool.token0, `${context}:token0`, entryErrors);
    validateToken(pool.token1, `${context}:token1`, entryErrors);

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

function validateToken(
  token: unknown,
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
  errorCode: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !EVM_ADDRESS_PATTERN.test(value)) {
    errors.push(errorCode);
  }
}

function isIntegerString(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
