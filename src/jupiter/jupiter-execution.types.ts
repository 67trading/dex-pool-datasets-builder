export type JupiterExecutionLeg = {
  programId: string;
  dex?: string;
  label?: string;
};

export type JupiterExecutionRecord = {
  signature: string;
  slot: number;
  blockTime: number;
  transactionIndex?: number;
  signer: string;
  instructionName?: string;

  inputMint: string;
  inputAmountRaw: string;
  inputDecimals?: number;

  outputMint: string;
  outputAmountRaw: string;
  outputDecimals?: number;

  /**
   * Every mint that moved in the signer's own token accounts (plus native
   * SOL under the wrapped-SOL mint address), including ones not chosen as
   * the primary input/output — kept for audit rather than silently
   * dropped (e.g. a third mint moving as a fee).
   */
  otherMintDeltasRaw: Array<{ mint: string; deltaRaw: string }>;

  /** AMM programs invoked as route legs, in transaction order (best-effort, not necessarily hop order). */
  legs: JupiterExecutionLeg[];
};

export type JupiterExecutionQualitySummary = {
  passed: boolean;
  duplicateSignatures: number;
  invalidTransactions: number;
  missingBlockTimestamps: number;
  noInputOutputResolved: number;
  incompleteRanges: number;
};

export type JupiterExecutionDatasetManifest = {
  datasetType: "JUPITER_EXECUTION";
  sourceMode: "SOLANA_PROGRAM_TRANSACTIONS";
  datasetId: string;
  programId: string;
  slotRange: {
    fromSlot: string;
    toSlot: string;
  };
  timeRange: {
    from: string;
    to: string;
  };
  recordCount: number;
  quality: JupiterExecutionQualitySummary;
  generatedAt: string;

  /**
   * Historical-truth caveat, stated explicitly per the plan: this is a
   * transaction-level record of executed Jupiter swaps, not a pool candle
   * dataset, and input/output mint resolution uses a signer-wallet
   * balance-diff heuristic (see jupiter-execution-reader.ts) rather than
   * protocol-level instruction decoding.
   */
  notes: string;
};
