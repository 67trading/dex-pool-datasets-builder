import type {
  SolanaJsonRpcClient,
  SolanaParsedMintData,
} from "./solana-json-rpc-client.js";

export async function fetchMintDecimals(
  client: SolanaJsonRpcClient,
  mint: string,
): Promise<number> {
  const account = await client.getAccountInfo(mint);
  if (account === null) {
    throw new Error(`SOLANA_MINT_NOT_FOUND:${mint}`);
  }

  const parsed = asParsedMintData(account.data);
  if (parsed === undefined) {
    throw new Error(`SOLANA_MINT_ACCOUNT_NOT_PARSEABLE:${mint}`);
  }

  return parsed.parsed.info.decimals;
}

function asParsedMintData(data: unknown): SolanaParsedMintData | undefined {
  if (Array.isArray(data) || typeof data !== "object" || data === null) {
    return undefined;
  }
  const candidate = data as Partial<SolanaParsedMintData>;
  if (candidate.parsed?.type === "mint") {
    return candidate as SolanaParsedMintData;
  }
  return undefined;
}
