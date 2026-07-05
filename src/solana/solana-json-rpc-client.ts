export type SolanaRpcFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export type SolanaSignatureInfo = {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;

  /**
   * Index of the transaction within its slot.
   *
   * Not documented as guaranteed by every RPC provider, but present on
   * public mainnet-beta and most commercial providers; used as the
   * secondary ordering component when present.
   */
  transactionIndex?: number;
};

export type SolanaTokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
};

export type SolanaParsedInstruction = {
  programId: string;
  program?: string;
  parsed?: unknown;
  data?: string;
  accounts?: string[];
  stackHeight?: number | null;
};

export type SolanaInnerInstructionGroup = {
  index: number;
  instructions: SolanaParsedInstruction[];
};

export type SolanaTransactionMeta = {
  err: unknown;
  fee: number;
  preBalances: number[];
  postBalances: number[];
  preTokenBalances?: SolanaTokenBalance[];
  postTokenBalances?: SolanaTokenBalance[];
  innerInstructions?: SolanaInnerInstructionGroup[];
  logMessages?: string[];
  loadedAddresses?: {
    writable: string[];
    readonly: string[];
  };
};

export type SolanaTransactionResult = {
  slot: number;
  blockTime: number | null;
  transactionIndex?: number;
  version?: number | "legacy";
  meta: SolanaTransactionMeta | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: Array<string | { pubkey: string; signer?: boolean; writable?: boolean }>;
      instructions: SolanaParsedInstruction[];
    };
  };
};

export type SolanaParsedMintData = {
  program: "spl-token" | "spl-token-2022";
  parsed: {
    type: "mint";
    info: {
      decimals: number;
      supply: string;
      isInitialized: boolean;
    };
  };
};

export type SolanaAccountInfo = {
  executable: boolean;
  owner: string;
  lamports: number;
  data: [string, string] | SolanaParsedMintData | Record<string, unknown>;
} | null;

export type GetSignaturesForAddressOptions = {
  limit?: number;
  before?: string;
  until?: string;
};

export type SolanaJsonRpcClient = {
  getSignaturesForAddress(
    address: string,
    options?: GetSignaturesForAddressOptions,
  ): Promise<SolanaSignatureInfo[]>;
  getTransaction(signature: string): Promise<SolanaTransactionResult | null>;
  getSlot(): Promise<number>;
  getAccountInfo(address: string): Promise<SolanaAccountInfo>;
};

export type SolanaJsonRpcClientOptions = {
  rpcUrl: string;
  fetchFn?: SolanaRpcFetch;
  retries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  timeoutMs?: number;
};

const GET_TRANSACTION_CONFIG = {
  encoding: "jsonParsed",
  maxSupportedTransactionVersion: 0,
} as const;

export function createSolanaJsonRpcClient(
  input: SolanaJsonRpcClientOptions,
): SolanaJsonRpcClient {
  const fetchFn = input.fetchFn ?? defaultFetch;
  const retries = input.retries ?? 5;
  const retryBaseDelayMs = input.retryBaseDelayMs ?? 500;
  const retryMaxDelayMs = input.retryMaxDelayMs ?? 10_000;
  const timeoutMs = input.timeoutMs ?? 30_000;

  let nextId = 1;

  async function request<T>(method: string, params: unknown[]): Promise<T> {
    const id = nextId;
    nextId += 1;

    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetchFn(input.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await readResponseTextSafely(response);
          throw new RetryableRpcError(
            `SOLANA_RPC_HTTP_ERROR:${response.status}:${text}`,
            text !== "<body_unavailable>" &&
              (isRetryableHttpStatus(response.status) || isRateLimitText(text)),
          );
        }

        const text = await response.text();
        const json = JSON.parse(text) as {
          id?: number;
          result?: T;
          error?: { code?: number; message?: string };
        };

        if (json.error !== undefined) {
          const code = json.error.code ?? "unknown";
          const message = json.error.message ?? "";
          throw new RetryableRpcError(
            `SOLANA_RPC_ERROR:${method}:${code}:${message}`,
            isRateLimitText(message) || isTimeoutText(message),
          );
        }

        if (json.result === undefined) {
          throw new Error(`SOLANA_RPC_RESULT_MISSING:${method}:${id}`);
        }

        return json.result;
      } catch (error: unknown) {
        lastError = error;
        const retryable = isRetryableCaughtError(error);

        if (!retryable || attempt >= retries) {
          throw error;
        }

        await sleep(getRetryDelayMs(attempt, retryBaseDelayMs, retryMaxDelayMs));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    getSignaturesForAddress(address, options = {}) {
      return request<SolanaSignatureInfo[]>("getSignaturesForAddress", [
        address,
        {
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
          ...(options.before !== undefined ? { before: options.before } : {}),
          ...(options.until !== undefined ? { until: options.until } : {}),
        },
      ]);
    },

    async getTransaction(signature) {
      return request<SolanaTransactionResult | null>("getTransaction", [
        signature,
        GET_TRANSACTION_CONFIG,
      ]);
    },

    async getSlot() {
      return request<number>("getSlot", [{ commitment: "confirmed" }]);
    },

    async getAccountInfo(address) {
      const response = await request<{ value: SolanaAccountInfo }>(
        "getAccountInfo",
        [address, { encoding: "jsonParsed" }],
      );
      return response.value;
    },
  };
}

class RetryableRpcError extends Error {
  public readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "RetryableRpcError";
    this.retryable = retryable;
  }
}

function isRetryableCaughtError(error: unknown): boolean {
  if (error instanceof RetryableRpcError) {
    return error.retryable;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("fetch failed") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("EAI_AGAIN") ||
    isRateLimitText(message)
  );
}

function isRetryableHttpStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function isRateLimitText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("rate limit") ||
    normalized.includes("rate-limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("429")
  );
}

function isTimeoutText(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("timeout") || normalized.includes("timed out");
}

function getRetryDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * baseDelayMs);
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readResponseTextSafely(response: {
  text: () => Promise<string>;
}): Promise<string> {
  return response.text().catch(() => "<body_unavailable>");
}

const defaultFetch: SolanaRpcFetch = async (url, init) => {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
};
