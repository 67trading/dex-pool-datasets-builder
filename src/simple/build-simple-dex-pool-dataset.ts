import { buildDexPoolDataset } from "../orchestrator/build-dex-pool-dataset.js";
import type { DexBuildResult } from "../orchestrator/dex-build-result.types.js";
import { resolveSimpleDexBuildConfig } from "./resolve-simple-build-config.js";
import type { SimpleDexBuildInput } from "./simple-build.types.js";

export async function buildSimpleDexPoolDataset(
  input: SimpleDexBuildInput,
): Promise<DexBuildResult> {
  const resolved = await resolveSimpleDexBuildConfig(input);
  return buildDexPoolDataset(resolved);
}
