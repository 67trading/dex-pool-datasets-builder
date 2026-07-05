/**
 * Jupiter quote is routing/discovery context, not a historical pool event
 * source (see the plan). This client only ever tells us what the router
 * would do *right now* — every quote is a forward-looking snapshot from
 * the moment it's fetched.
 */
export type JupiterSwapInfo = {
  ammKey: string;
  label?: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  feeAmount?: string;
  feeMint?: string;
};

export type JupiterRoutePlanStep = {
  swapInfo: JupiterSwapInfo;
  percent: number;
  bps?: number | null;
};

export type JupiterQuoteResponse = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  priceImpactPct: string;
  routePlan: JupiterRoutePlanStep[];
  contextSlot: number;
  timeTaken: number;
};

export type JupiterQuoteRequest = {
  inputMint: string;
  outputMint: string;
  amount: string | bigint;
  slippageBps?: number;
  excludeDexes?: string[];
  swapMode?: "ExactIn" | "ExactOut";
};

export type JupiterFetch = (
  url: string,
  init: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export type JupiterQuoteClientOptions = {
  baseUrl?: string;
  fetchFn?: JupiterFetch;
  timeoutMs?: number;
  retries?: number;
};

const DEFAULT_BASE_URL = "https://lite-api.jup.ag/swap/v1";

export async function getJupiterQuote(
  input: JupiterQuoteRequest,
  options: JupiterQuoteClientOptions = {},
): Promise<JupiterQuoteResponse> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retries = options.retries ?? 3;

  const params = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount.toString(),
    slippageBps: (input.slippageBps ?? 50).toString(),
    swapMode: input.swapMode ?? "ExactIn",
  });
  if (input.excludeDexes !== undefined && input.excludeDexes.length > 0) {
    params.set("excludeDexes", input.excludeDexes.join(","));
  }

  const url = `${baseUrl}/quote?${params.toString()}`;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(url, { signal: controller.signal });
      const text = await response.text();

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new Error(`JUPITER_QUOTE_HTTP_ERROR:${response.status}:${text}`);
      }

      return JSON.parse(text) as JupiterQuoteResponse;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
