import { resolveDatasetStorage } from "../storage/resolve-dataset-storage.js";
import { getJupiterQuote } from "./jupiter-quote-client.js";

export type JupiterQuoteSampleSeed = {
  inputMint: string;
  outputMint: string;
  amount: string;
};

export type JupiterQuoteSnapshotRecord = {
  sampledAt: string;
  contextSlot: number;
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  priceImpactPct: string;
  routePlan: Array<{
    ammKey: string;
    label?: string;
    inputMint: string;
    outputMint: string;
    inAmountRaw: string;
    outAmountRaw: string;
  }>;
};

export type JupiterQuoteSnapshotManifest = {
  datasetType: "JUPITER_QUOTE_SNAPSHOT";
  sourceMode: "JUPITER_API_SAMPLER";
  datasetId: string;
  seeds: JupiterQuoteSampleSeed[];
  sampleCount: number;
  timeRange: {
    from: string;
    to: string;
  };
  generatedAt: string;

  /** Stated explicitly per the plan — this is not, and cannot be, a historical dataset. */
  notes: string;
};

export async function sampleJupiterQuotesOnce(
  seeds: JupiterQuoteSampleSeed[],
): Promise<JupiterQuoteSnapshotRecord[]> {
  const sampledAt = new Date().toISOString();
  const records: JupiterQuoteSnapshotRecord[] = [];

  for (const seed of seeds) {
    const quote = await getJupiterQuote({
      inputMint: seed.inputMint,
      outputMint: seed.outputMint,
      amount: seed.amount,
    });

    records.push({
      sampledAt,
      contextSlot: quote.contextSlot,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmountRaw: quote.inAmount,
      outAmountRaw: quote.outAmount,
      priceImpactPct: quote.priceImpactPct,
      routePlan: quote.routePlan.map((step) => ({
        ammKey: step.swapInfo.ammKey,
        label: step.swapInfo.label,
        inputMint: step.swapInfo.inputMint,
        outputMint: step.swapInfo.outputMint,
        inAmountRaw: step.swapInfo.inAmount,
        outAmountRaw: step.swapInfo.outAmount,
      })),
    });
  }

  return records;
}

export type RunJupiterQuoteSamplerOptions = {
  datasetId: string;
  outputUri: string;
  seeds: JupiterQuoteSampleSeed[];
  intervalSeconds?: number;
  durationSeconds?: number;
  onSample?: (event: { iteration: number; records: JupiterQuoteSnapshotRecord[] }) => void;
};

export type RunJupiterQuoteSamplerResult = {
  sampleCount: number;
  manifest: JupiterQuoteSnapshotManifest;
};

/**
 * Runs one or more sampling passes and appends every sample to a single
 * JSONL file — a forward-only log from the moment sampling started, never
 * a backfilled history (see plan: quote snapshots are P5, not P1/P2).
 */
export async function runJupiterQuoteSampler(
  options: RunJupiterQuoteSamplerOptions,
): Promise<RunJupiterQuoteSamplerResult> {
  const storage = resolveDatasetStorage(options.outputUri);
  const key = `${options.datasetId}/jupiter-quote-snapshots.jsonl`;

  const allRecords: JupiterQuoteSnapshotRecord[] = [];
  const intervalSeconds = options.intervalSeconds ?? 0;
  const durationSeconds = options.durationSeconds ?? 0;
  const iterations = intervalSeconds > 0 && durationSeconds > 0
    ? Math.max(1, Math.floor(durationSeconds / intervalSeconds) + 1)
    : 1;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const records = await sampleJupiterQuotesOnce(options.seeds);
    allRecords.push(...records);
    options.onSample?.({ iteration, records });

    if (iteration < iterations - 1 && intervalSeconds > 0) {
      await sleep(intervalSeconds * 1000);
    }
  }

  const jsonlBody =
    allRecords.map((record) => JSON.stringify(record)).join("\n") +
    (allRecords.length > 0 ? "\n" : "");

  await storage.writeObject({
    key,
    body: jsonlBody,
    contentType: "application/x-ndjson",
  });

  const generatedAt = new Date().toISOString();
  const manifest: JupiterQuoteSnapshotManifest = {
    datasetType: "JUPITER_QUOTE_SNAPSHOT",
    sourceMode: "JUPITER_API_SAMPLER",
    datasetId: options.datasetId,
    seeds: options.seeds,
    sampleCount: allRecords.length,
    timeRange: {
      from: allRecords[0]?.sampledAt ?? generatedAt,
      to: allRecords.at(-1)?.sampledAt ?? generatedAt,
    },
    generatedAt,
    notes:
      "Forward-looking Jupiter routing snapshots only, valid from the moment " +
      "each sample was taken. Not historically complete and not a replay-safe " +
      "pool candle source — see the DEX_POOL / SOLANA_AMM_STYLE dataset family " +
      "for that.",
  };

  await storage.writeObject({
    key: `${options.datasetId}/manifest.json`,
    body: `${JSON.stringify(manifest, null, 2)}\n`,
    contentType: "application/json",
  });

  return { sampleCount: allRecords.length, manifest };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
