import { randomUUID } from "node:crypto";
import { resolveDatasetStorage } from "../storage/resolve-dataset-storage.js";
import { JUPITER_V6_PROGRAM_ID } from "../solana/solana-amm-program-registry.js";
import { readJupiterExecutionsWithQuality } from "./jupiter-execution-reader.js";
import type { JupiterExecutionDatasetManifest } from "./jupiter-execution.types.js";

export type BuildJupiterExecutionDatasetOptions = {
  datasetId: string;
  rpcUrl: string;
  outputUri: string;
  fromSlot: bigint;
  toSlot: bigint;
  failFast?: boolean;
  onProgress?: (event: { type: "executions_decoded"; count: number }) => void;
};

export type BuildJupiterExecutionDatasetResult = {
  status: "completed" | "failed";
  recordCount: number;
  manifest: JupiterExecutionDatasetManifest;
};

export async function buildJupiterExecutionDataset(
  options: BuildJupiterExecutionDatasetOptions,
): Promise<BuildJupiterExecutionDatasetResult> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const storage = resolveDatasetStorage(options.outputUri);

  const { executions, quality } = await readJupiterExecutionsWithQuality({
    rpcUrl: options.rpcUrl,
    fromBlock: options.fromSlot,
    toBlock: options.toSlot,
    failFast: options.failFast,
    onProgress: options.onProgress,
  });

  const jsonlBody =
    executions.map((record) => JSON.stringify(record)).join("\n") +
    (executions.length > 0 ? "\n" : "");

  await storage.writeObject({
    key: `${options.datasetId}/jupiter-executions.jsonl`,
    body: jsonlBody,
    contentType: "application/x-ndjson",
  });

  const qualityBody = `${JSON.stringify(quality, null, 2)}\n`;
  await storage.writeObject({
    key: `${options.datasetId}/jupiter-execution-quality.json`,
    body: qualityBody,
    contentType: "application/json",
  });

  const firstBlockTime = executions[0]?.blockTime;
  const lastBlockTime = executions.at(-1)?.blockTime;
  const generatedAt = new Date().toISOString();

  const manifest: JupiterExecutionDatasetManifest = {
    datasetType: "JUPITER_EXECUTION",
    sourceMode: "SOLANA_PROGRAM_TRANSACTIONS",
    datasetId: options.datasetId,
    programId: JUPITER_V6_PROGRAM_ID,
    slotRange: {
      fromSlot: options.fromSlot.toString(),
      toSlot: options.toSlot.toString(),
    },
    timeRange: {
      from: firstBlockTime !== undefined ? new Date(firstBlockTime * 1000).toISOString() : generatedAt,
      to: lastBlockTime !== undefined ? new Date(lastBlockTime * 1000).toISOString() : generatedAt,
    },
    recordCount: executions.length,
    quality,
    generatedAt,
    notes:
      "Historical executed Jupiter swaps, not a pool candle dataset. " +
      "input/output mint + amount are derived from the signing wallet's own " +
      "token-balance deltas (plus native SOL lamport delta), not from " +
      "protocol-level instruction decoding — see jupiter-execution-reader.ts.",
  };

  await storage.writeObject({
    key: `${options.datasetId}/manifest.json`,
    body: `${JSON.stringify(manifest, null, 2)}\n`,
    contentType: "application/json",
  });

  // Reaching this point means the reader didn't throw; quality issues are
  // recorded but don't themselves fail the run (mirrors buildDexPoolDataset).
  const status: "completed" | "failed" = "completed";
  const finishedAt = new Date().toISOString();

  await storage.writeObject({
    key: `${options.datasetId}/run-report.json`,
    body: `${JSON.stringify(
      {
        schemaVersion: 1,
        datasetId: options.datasetId,
        runId,
        startedAt,
        finishedAt,
        status,
        recordCount: executions.length,
        quality,
      },
      null,
      2,
    )}\n`,
    contentType: "application/json",
  });

  return { status, recordCount: executions.length, manifest };
}
