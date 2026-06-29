import { readFile } from "node:fs/promises";
import type { DexBuildConfig } from "./dex-build-config.types.js";

export async function loadDexBuildConfig(
  configPath: string,
): Promise<DexBuildConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    throw new Error(`CONFIG_NOT_FOUND:${configPath}`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`CONFIG_PARSE_ERROR:${configPath}`, { cause: error });
  }
  return parsed as DexBuildConfig;
}
