import { createSolanaJsonRpcClient } from "../solana/solana-json-rpc-client.js";
import { fetchMintDecimals } from "../solana/solana-mint-metadata.js";
import { findSolanaAmmProgram } from "../solana/solana-amm-program-registry.js";
import {
  getJupiterQuote,
  type JupiterQuoteClientOptions,
} from "./jupiter-quote-client.js";

export type JupiterDiscoverySeed = {
  inputMint: string;
  outputMint: string;
  /** Sampled at each amount to surface different routes/legs (size-dependent routing). */
  amounts: string[];
};

export type JupiterDiscoverPoolsOptions = {
  seeds: JupiterDiscoverySeed[];
  solanaRpcUrl: string;
  mintSymbols?: Record<string, string>;
  quoteClientOptions?: JupiterQuoteClientOptions;
  excludeDexes?: string[];
};

/**
 * A pool candidate surfaced via Jupiter routing, resolved against a known
 * AMM program (see solana-amm-program-registry.ts). This is a discovery
 * artifact, not a build-ready registry entry: it has no `id`/`startBlock`
 * because Jupiter can't tell us those — a human decides which candidates
 * are worth promoting into an actual pool registry file.
 */
export type SolanaPoolCandidate = {
  chain: "solana";
  dex: string;
  kind: "SOLANA_AMM_STYLE";
  poolAddress: string;
  programId: string;
  jupiterLabel?: string;
  token0: { symbol: string; address: string; decimals: number };
  token1: { symbol: string; address: string; decimals: number };
  baseToken: "token0";
  quoteToken: "token1";
  discoveredAtSlot: number;
};

export type UnrecognizedRouteLeg = {
  ammKey: string;
  jupiterLabel?: string;
  ownerProgramId: string;
};

export type JupiterDiscoverPoolsResult = {
  candidates: SolanaPoolCandidate[];
  /**
   * Legs Jupiter routed through that don't match any program in
   * solana-amm-program-registry.ts. Reported, not silently dropped — the
   * live routing landscape includes many venues beyond Orca/Raydium/
   * Meteora (private market makers, RFQ venues) that this reader cannot
   * decode via the token-balance-diff technique.
   */
  unrecognized: UnrecognizedRouteLeg[];
};

export async function discoverSolanaPoolsViaJupiter(
  options: JupiterDiscoverPoolsOptions,
): Promise<JupiterDiscoverPoolsResult> {
  const client = createSolanaJsonRpcClient({ rpcUrl: options.solanaRpcUrl });

  const legsByAmmKey = new Map<
    string,
    { label?: string; inputMint: string; outputMint: string }
  >();

  for (const seed of options.seeds) {
    for (const amount of seed.amounts) {
      const quote = await getJupiterQuote(
        {
          inputMint: seed.inputMint,
          outputMint: seed.outputMint,
          amount,
          excludeDexes: options.excludeDexes,
        },
        options.quoteClientOptions,
      );

      for (const step of quote.routePlan) {
        const info = step.swapInfo;
        if (!legsByAmmKey.has(info.ammKey)) {
          legsByAmmKey.set(info.ammKey, {
            label: info.label,
            inputMint: info.inputMint,
            outputMint: info.outputMint,
          });
        }
      }
    }
  }

  const candidates: SolanaPoolCandidate[] = [];
  const unrecognized: UnrecognizedRouteLeg[] = [];
  const slot = await client.getSlot();

  for (const [ammKey, leg] of legsByAmmKey) {
    const account = await client.getAccountInfo(ammKey);
    if (account === null) continue;

    const registryEntry = findSolanaAmmProgram(account.owner);
    if (registryEntry === undefined) {
      unrecognized.push({
        ammKey,
        jupiterLabel: leg.label,
        ownerProgramId: account.owner,
      });
      continue;
    }

    const [token0Decimals, token1Decimals] = await Promise.all([
      fetchMintDecimals(client, leg.inputMint),
      fetchMintDecimals(client, leg.outputMint),
    ]);

    candidates.push({
      chain: "solana",
      dex: registryEntry.dex,
      kind: "SOLANA_AMM_STYLE",
      poolAddress: ammKey,
      programId: account.owner,
      jupiterLabel: leg.label,
      token0: {
        symbol: symbolFor(leg.inputMint, options.mintSymbols),
        address: leg.inputMint,
        decimals: token0Decimals,
      },
      token1: {
        symbol: symbolFor(leg.outputMint, options.mintSymbols),
        address: leg.outputMint,
        decimals: token1Decimals,
      },
      baseToken: "token0",
      quoteToken: "token1",
      discoveredAtSlot: slot,
    });
  }

  return { candidates, unrecognized };
}

function symbolFor(
  mint: string,
  mintSymbols: Record<string, string> | undefined,
): string {
  return mintSymbols?.[mint] ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
