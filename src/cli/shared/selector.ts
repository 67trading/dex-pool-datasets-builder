import { isSolanaAddress } from "../../solana/solana-address.js";

export type ParsedDexSelector = {
  chain?: string;
  pair?: string;
  pool?: string;
};

export function parseDexSelector(selector: string | undefined): ParsedDexSelector | undefined {
  if (selector === undefined || selector.trim().length === 0) {
    return undefined;
  }

  const trimmed = selector.trim();
  const separatorIndex = trimmed.indexOf(":");

  if (separatorIndex === -1) {
    return parseSelectorSubject(trimmed);
  }

  const chain = trimmed.slice(0, separatorIndex).trim();
  const subject = trimmed.slice(separatorIndex + 1).trim();

  if (chain.length === 0 || subject.length === 0) {
    throw new Error(`DEX_SELECTOR_INVALID:${selector}`);
  }

  return {
    chain,
    ...parseSelectorSubject(subject),
  };
}

function parseSelectorSubject(subject: string): Pick<ParsedDexSelector, "pair" | "pool"> {
  if (subject.length === 0) {
    throw new Error("DEX_SELECTOR_EMPTY");
  }

  if (looksLikePoolAddress(subject)) {
    return { pool: subject };
  }

  return { pair: subject };
}

const EVM_POOL_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

/**
 * A selector subject with no `/` is either a pool address or a bare
 * single-token symbol (rejected downstream). Checked against both EVM hex
 * and Solana base58 pool address shapes since the chain prefix alone
 * (e.g. "solana:") isn't parsed out here — callers resolve chain-specific
 * pool config separately.
 */
function looksLikePoolAddress(value: string): boolean {
  return EVM_POOL_ADDRESS_PATTERN.test(value) || isSolanaAddress(value);
}
