/**
 * Known Solana AMM program ids that the pool swap reader can decode.
 *
 * This is an allowlist, not a closed enum: the reader refuses to treat a
 * transaction as a pool swap unless it actually invoked one of these
 * program ids (see solana-pool-swap-reader.ts). Every id below was
 * verified live against mainnet-beta (getAccountInfo executable=true)
 * at the time it was added; verify again before trusting an old entry.
 *
 * The live Jupiter routing landscape includes many more AMMs than the
 * three families named in the plan (Orca/Raydium/Meteora) — e.g. newer
 * long-tail aggregated venues show up in routePlan too. Add entries here
 * as they're confirmed rather than assuming this list is exhaustive.
 */
export type SolanaAmmProgramEntry = {
  programId: string;
  dex: string;
  label: string;
};

export const SOLANA_AMM_PROGRAM_REGISTRY: SolanaAmmProgramEntry[] = [
  {
    programId: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    dex: "orca",
    label: "Orca Whirlpool",
  },
  {
    programId: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    dex: "raydium",
    label: "Raydium AMM v4",
  },
  {
    programId: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
    dex: "raydium",
    label: "Raydium CLMM",
  },
  {
    programId: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
    dex: "raydium",
    label: "Raydium CPMM",
  },
  {
    programId: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
    dex: "meteora",
    label: "Meteora DLMM",
  },
  {
    programId: "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",
    dex: "meteora",
    label: "Meteora Dynamic AMM",
  },
];

const BY_PROGRAM_ID = new Map(
  SOLANA_AMM_PROGRAM_REGISTRY.map((entry) => [entry.programId, entry]),
);

export function findSolanaAmmProgram(
  programId: string,
): SolanaAmmProgramEntry | undefined {
  return BY_PROGRAM_ID.get(programId);
}

export function isKnownSolanaAmmProgram(programId: string): boolean {
  return BY_PROGRAM_ID.has(programId);
}

/** Jupiter aggregator program id, verified live 2026-07 (see jupiter-execution-reader.ts). */
export const JUPITER_V6_PROGRAM_ID =
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
