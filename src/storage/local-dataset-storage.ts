import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  DatasetStorage,
  DatasetStorageKind,
  WriteDatasetObjectInput,
  WrittenDatasetObject,
} from "./dataset-storage.types.js";

export function parseLocalUri(uri: string): string {
  if (!uri.startsWith("local://")) {
    throw new Error(`LOCAL_URI_INVALID:${uri}`);
  }
  return uri.slice("local://".length);
}

export class LocalDatasetStorage implements DatasetStorage {
  readonly kind: DatasetStorageKind = "local";

  constructor(private readonly rootDir: string) {}

  async writeObject(
    input: WriteDatasetObjectInput,
  ): Promise<WrittenDatasetObject> {
    const absolutePath = resolve(join(this.rootDir, input.key));
    await mkdir(resolve(absolutePath, ".."), { recursive: true });
    const body = input.body;
    await writeFile(absolutePath, body);
    const sizeBytes =
      typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.length;
    return {
      key: input.key,
      uri: `local://${absolutePath}`,
      sizeBytes,
    };
  }

  async readObject(key: string): Promise<Uint8Array> {
    const absolutePath = resolve(join(this.rootDir, key));
    return readFile(absolutePath);
  }

  async exists(key: string): Promise<boolean> {
    const absolutePath = resolve(join(this.rootDir, key));
    try {
      await access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }
}
