import type {
  SolanaTokenBalance,
  SolanaTransactionMeta,
} from "./solana-json-rpc-client.js";

/**
 * Derives the gross amount of a given mint that moved within a
 * transaction, from the transaction-wide preTokenBalances/postTokenBalances
 * snapshot — without needing to know which specific accounts are pool
 * vaults vs trader wallets, and without decoding any protocol-specific
 * instruction/account byte layout.
 *
 * Technique: in a closed set of token accounts, the sum of all positive
 * balance deltas for a mint equals the sum of all negative deltas
 * (conservation of token supply within the tx). Either sum is the gross
 * amount transferred. We take the max of the two sums because a token
 * account created and closed within the same transaction (a common
 * "wrap SOL -> swap -> unwrap" pattern) is invisible to whichever side
 * (pre or post) it doesn't exist on, which can make one side undercount.
 *
 * Known limitation: if a transaction contains transfers of the same mint
 * unrelated to the swap itself, this overcounts. This is why the reader
 * only applies it to transactions that directly invoke a single known
 * AMM program (see solana-pool-swap-reader.ts) rather than arbitrary
 * multi-hop routed transactions.
 */
export function computeMintGrossDeltaRaw(
  meta: Pick<SolanaTransactionMeta, "preTokenBalances" | "postTokenBalances">,
  mint: string,
): bigint {
  const preByIndex = indexByAccount(meta.preTokenBalances, mint);
  const postByIndex = indexByAccount(meta.postTokenBalances, mint);

  const accountIndexes = new Set<number>([
    ...preByIndex.keys(),
    ...postByIndex.keys(),
  ]);

  let sumPositive = 0n;
  let sumNegative = 0n;

  for (const accountIndex of accountIndexes) {
    const pre = preByIndex.get(accountIndex) ?? 0n;
    const post = postByIndex.get(accountIndex) ?? 0n;
    const delta = post - pre;

    if (delta > 0n) {
      sumPositive += delta;
    } else if (delta < 0n) {
      sumNegative += -delta;
    }
  }

  return sumPositive > sumNegative ? sumPositive : sumNegative;
}

function indexByAccount(
  balances: SolanaTokenBalance[] | undefined,
  mint: string,
): Map<number, bigint> {
  const map = new Map<number, bigint>();
  for (const balance of balances ?? []) {
    if (balance.mint !== mint) continue;
    map.set(balance.accountIndex, BigInt(balance.uiTokenAmount.amount));
  }
  return map;
}

export function formatRawAmount(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}
