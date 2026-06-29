import type {
  SimpleDexBuildInput,
  SimplePairSelectionInput,
  SimplePoolSelectionInput,
} from "./simple-build.types.js";

export function normalizeSimplePoolSelections(
  input: SimpleDexBuildInput,
): SimplePoolSelectionInput[] {
  const selections: SimplePoolSelectionInput[] = [];

  if (input.symbols !== undefined && input.symbols.length > 0) {
    for (const symbol of input.symbols) {
      selections.push(normalizeSymbolSelection(symbol));
    }
  }

  if (input.pairs !== undefined && input.pairs.length > 0) {
    for (const pair of input.pairs) {
      selections.push(parsePairSelection(pair));
    }
  }

  if (input.pools !== undefined && input.pools.length > 0) {
    for (const pool of input.pools) {
      selections.push({
        pool,
      });
    }
  }

  if (selections.length === 0 && hasSingleSelection(input)) {
    selections.push({
      pool: input.pool,
      pair: input.pair,
      fee: input.fee,
      token0: input.token0,
      token1: input.token1,
      base: input.base,
      quote: input.quote,
    });
  }

  const normalized = dedupeSelections(selections);

  if (normalized.length === 0) {
    throw new Error(
      "SIMPLE_POOL_SELECTION_REQUIRED: pass --pool, --pair, --pairs, --pools, or symbols[]",
    );
  }

  return normalized;
}

/**
 * Parses CLI --pairs input into raw pair selections.
 *
 * Important:
 * This intentionally does NOT call parsePairSelection().
 * SimpleDexBuildInput.pairs stores raw pair inputs, and normalizeSimplePoolSelections()
 * parses them later.
 *
 * Example:
 * --pairs WETH/USDC,cbBTC/WETH:3000
 *
 * returns:
 * ["WETH/USDC", "cbBTC/WETH:3000"]
 */
export function parsePairsList(
  value: string | undefined,
): SimplePairSelectionInput[] | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parsePoolsList(
  value: string | undefined,
): string[] | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parsePairSelection(
  input: SimplePairSelectionInput,
): SimplePoolSelectionInput {
  if (typeof input !== "string") {
    if (input.pair.trim().length === 0) {
      throw new Error("SIMPLE_PAIR_INVALID:empty");
    }

    return {
      pair: input.pair.trim(),
      fee: input.fee,
      base: input.base,
      quote: input.quote,
    };
  }

  const value = input.trim();

  if (value.length === 0) {
    throw new Error("SIMPLE_PAIR_INVALID:empty");
  }

  const colonIndex = value.lastIndexOf(":");

  if (colonIndex === -1) {
    return {
      pair: value,
    };
  }

  const pair = value.slice(0, colonIndex).trim();
  const fee = value.slice(colonIndex + 1).trim();

  if (pair.length === 0 || fee.length === 0) {
    throw new Error(`SIMPLE_PAIR_INVALID:${input}`);
  }

  return {
    pair,
    fee,
  };
}

function normalizeSymbolSelection(
  input: SimplePoolSelectionInput,
): SimplePoolSelectionInput {
  if (input.pool !== undefined && input.pool.length > 0) {
    return {
      pool: input.pool,
      base: input.base,
      quote: input.quote,
    };
  }

  if (input.pair !== undefined && input.pair.length > 0) {
    return {
      pair: input.pair,
      fee: input.fee,
      base: input.base,
      quote: input.quote,
    };
  }

  if (input.token0 !== undefined || input.token1 !== undefined) {
    return {
      token0: input.token0,
      token1: input.token1,
      fee: input.fee,
      base: input.base,
      quote: input.quote,
    };
  }

  throw new Error("SIMPLE_SYMBOL_SELECTION_INVALID");
}

function hasSingleSelection(input: SimpleDexBuildInput): boolean {
  return (
    input.pool !== undefined ||
    input.pair !== undefined ||
    input.token0 !== undefined ||
    input.token1 !== undefined
  );
}

function dedupeSelections(
  selections: SimplePoolSelectionInput[],
): SimplePoolSelectionInput[] {
  const seen = new Set<string>();
  const result: SimplePoolSelectionInput[] = [];

  for (const selection of selections) {
    const key = selectionKey(selection);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(selection);
  }

  return result;
}

function selectionKey(selection: SimplePoolSelectionInput): string {
  if (selection.pool !== undefined) {
    return `pool:${selection.pool.toLowerCase()}`;
  }

  if (selection.pair !== undefined) {
    return `pair:${selection.pair.toUpperCase()}:${String(selection.fee ?? "preset")}`;
  }

  if (selection.token0 !== undefined || selection.token1 !== undefined) {
    return [
      "tokens",
      selection.token0?.toLowerCase() ?? "",
      selection.token1?.toLowerCase() ?? "",
      String(selection.fee ?? ""),
    ].join(":");
  }

  return JSON.stringify(selection);
}
