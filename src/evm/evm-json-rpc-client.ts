export type HexString = `0x${string}`;

export type EvmRpcFetch = (
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

export type EvmLog = {
  address: HexString;
  topics: HexString[];
  data: HexString;
  blockNumber: HexString;
  blockHash: HexString;
  transactionHash: HexString;
  transactionIndex: HexString;
  logIndex: HexString;
};

export type EvmBlock = {
  number: HexString;
  hash: HexString;
  timestamp: HexString;
};

export type GetLogsInput = {
  address?: HexString | HexString[];
  fromBlock: bigint;
  toBlock: bigint;
  topics?: HexString[];
};

export type EvmBlockTag = bigint | "latest";

export type EvmCallInput = {
  to: HexString;
  data: HexString;
  blockTag?: EvmBlockTag;
};

export type EvmJsonRpcClientOptions = {
  rpcUrl: string;
  fetchFn?: EvmRpcFetch;

  /**
   * Number of retries after the initial request.
   *
   * Example:
   * retries=5 means max 6 attempts total.
   */
  retries?: number;

  /**
   * Initial retry delay.
   */
  retryBaseDelayMs?: number;

  /**
   * Maximum retry delay.
   */
  retryMaxDelayMs?: number;

  /**
   * Per-request timeout.
   */
  timeoutMs?: number;
};

export type EvmJsonRpcClient = {
  getLogs(input: GetLogsInput): Promise<EvmLog[]>;
  getBlockByNumber(blockNumber: bigint): Promise<EvmBlock>;
  getLatestBlockNumber(): Promise<bigint>;
  getChainId(): Promise<bigint>;
  call(input: EvmCallInput): Promise<HexString>;
};

export function createEvmJsonRpcClient(
  input: EvmJsonRpcClientOptions,
): EvmJsonRpcClient {
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
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            method,
            params,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await readResponseTextSafely(response);
          const error = new RetryableRpcError(
            `EVM_RPC_HTTP_ERROR:${response.status}:${text}`,
            text !== "<body_unavailable>" &&
              (isRetryableHttpStatus(response.status) || isRateLimitText(text)),
          );

          throw error;
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
          const error = new RetryableRpcError(
            `EVM_RPC_ERROR:${method}:${code}:${message}`,
            isRetryableJsonRpcError(json.error.code, message),
          );

          throw error;
        }

        if (json.result === undefined) {
          throw new Error(`EVM_RPC_RESULT_MISSING:${method}:${id}`);
        }

        return json.result;
      } catch (error: unknown) {
        lastError = error;

        const retryable = isRetryableCaughtError(error);

        if (!retryable || attempt >= retries) {
          throw error;
        }

        await sleep(
          getRetryDelayMs(attempt, retryBaseDelayMs, retryMaxDelayMs),
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    getLogs(getLogsInput) {
      return request<EvmLog[]>("eth_getLogs", [
        {
          ...(getLogsInput.address !== undefined
            ? { address: getLogsInput.address }
            : {}),
          fromBlock: toQuantityHex(getLogsInput.fromBlock),
          toBlock: toQuantityHex(getLogsInput.toBlock),
          ...(getLogsInput.topics !== undefined
            ? { topics: getLogsInput.topics }
            : {}),
        },
      ]);
    },

    getBlockByNumber(blockNumber) {
      return request<EvmBlock>("eth_getBlockByNumber", [
        toQuantityHex(blockNumber),
        false,
      ]);
    },

    async getLatestBlockNumber() {
      return hexToBigInt(await request<HexString>("eth_blockNumber", []));
    },

    async getChainId() {
      return hexToBigInt(await request<HexString>("eth_chainId", []));
    },

    call(callInput) {
      return request<HexString>("eth_call", [
        {
          to: callInput.to,
          data: callInput.data,
        },
        toBlockTag(callInput.blockTag ?? "latest"),
      ]);
    },
  };
}

export function toQuantityHex(value: bigint): HexString {
  if (value < 0n) {
    throw new Error(`EVM_QUANTITY_NEGATIVE:${value.toString()}`);
  }

  return `0x${value.toString(16)}`;
}

export function hexToBigInt(value: HexString): bigint {
  return BigInt(value);
}

export function hexToNumber(value: HexString): number {
  const parsed = hexToBigInt(value);

  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`EVM_HEX_UNSAFE_NUMBER:${value}`);
  }

  return Number(parsed);
}

function toBlockTag(value: EvmBlockTag): HexString | "latest" {
  return value === "latest" ? "latest" : toQuantityHex(value);
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

function isRetryableJsonRpcError(
  code: number | undefined,
  message: string,
): boolean {
  if (code === -32016 || code === -32005 || code === -32000) {
    return (
      isRateLimitText(message) ||
      isTimeoutText(message) ||
      isCapacityText(message)
    );
  }

  return (
    isRateLimitText(message) ||
    isTimeoutText(message) ||
    isCapacityText(message)
  );
}

function isRateLimitText(text: string): boolean {
  const normalized = text.toLowerCase();

  return (
    normalized.includes("rate limit") ||
    normalized.includes("rate-limit") ||
    normalized.includes("over rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("429")
  );
}

function isTimeoutText(text: string): boolean {
  const normalized = text.toLowerCase();

  return normalized.includes("timeout") || normalized.includes("timed out");
}

function isCapacityText(text: string): boolean {
  const normalized = text.toLowerCase();

  return (
    normalized.includes("temporarily unavailable") ||
    normalized.includes("service unavailable") ||
    normalized.includes("capacity") ||
    normalized.includes("busy")
  );
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

const defaultFetch: EvmRpcFetch = async (url, init) => {
  const response = await fetch(url, init);

  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
};
