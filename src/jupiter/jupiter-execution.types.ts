import type { BackfillCompleteness } from "../types/dex-pool-dataset.types.js";

export type JupiterRecognizedAmmProgram = {
  programId: string;
  dex?: string;
  label?: string;
};

export type JupiterExecutionResolutionConfidence = "HIGH" | "MEDIUM" | "LOW";

export type JupiterExecutionResolutionMethod =
  | "SIGNER_TOKEN_BALANCE_DIFF"
  | "FEE_PAYER_NATIVE_SOL_ADJUSTED"
  | "PARSED_JUPITER_INSTRUCTION"
  | "UNKNOWN";

export type JupiterExecutionQualityFlags = {
  /** More than one signer on the transaction — accountKeys[0] may not be the economically relevant trader. */
  multiSigner?: boolean;
  /** Same signal as multiSigner surfaced separately: with multiple signers we can't be certain the assumed signer/fee-payer is the token owner whose deltas we read. */
  feePayerNotTokenOwner?: boolean;
  /** Native/wrapped SOL was part of the resolved input or output — ATA rent create/close noise can distort the lamport-delta calculation. */
  nativeSolRentAmbiguity?: boolean;
  /** More than one mint had a negative (outgoing) delta on the signer's accounts — the chosen "input" is the largest, not unambiguous. */
  multipleNegativeDeltas?: boolean;
  /** More than one mint had a positive (incoming) delta on the signer's accounts — the chosen "output" is the largest, not unambiguous. */
  multiplePositiveDeltas?: boolean;
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

  /**
   * AMM programs invoked as route legs that are present in
   * solana-amm-program-registry.ts — NOT a reconstruction of Jupiter's
   * actual routePlan (no per-leg amounts, split percentages, or hop
   * order; programs invoked but unrecognized are simply absent here).
   */
  recognizedAmmPrograms: JupiterRecognizedAmmProgram[];
  routeLegsApproximate: true;

  resolutionConfidence: JupiterExecutionResolutionConfidence;
  resolutionMethod: JupiterExecutionResolutionMethod;
  qualityFlags: JupiterExecutionQualityFlags;
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
  backfillCompleteness: BackfillCompleteness;
  generatedAt: string;

  /**
   * Historical-truth caveat, stated explicitly per the plan: this is a
   * transaction-level record of executed Jupiter swaps, not a pool candle
   * dataset, and input/output mint resolution uses a signer-wallet
   * balance-diff heuristic (see jupiter-execution-reader.ts) rather than
   * protocol-level instruction decoding. Not guaranteed complete for the
   * requested range unless backfillCompleteness.rangeComplete is true.
   */
  notes: string;
};
