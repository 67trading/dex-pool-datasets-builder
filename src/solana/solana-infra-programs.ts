/** Wrapped/native SOL mint — fungible 1:1 with lamports. */
export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Programs that show up in nearly every Solana transaction and carry no
 * "this is a route hop" signal on their own — excluded when looking for
 * other non-trivial programs invoked alongside a swap (multiHopSuspected).
 */
export const SOLANA_INFRA_PROGRAM_IDS = new Set<string>([
  "11111111111111111111111111111111", // System program
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // SPL Token-2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token Account
]);
