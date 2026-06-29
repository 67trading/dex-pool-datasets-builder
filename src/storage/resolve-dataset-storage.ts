import { S3Client } from "@aws-sdk/client-s3";
import type { DatasetStorage } from "./dataset-storage.types.js";
import { LocalDatasetStorage } from "./local-dataset-storage.js";
import { parseStorageUri } from "./parse-storage-uri.js";
import { S3DatasetStorage } from "./s3-dataset-storage.js";

export function resolveDatasetStorage(uri: string): DatasetStorage {
  const parsed = parseStorageUri(uri);
  if (parsed.kind === "local") {
    return new LocalDatasetStorage(parsed.rootDir);
  }
  if (parsed.kind === "s3") {
    const client = new S3Client({}); // uses AWS credential chain
    return new S3DatasetStorage(client, parsed.bucket, parsed.prefix);
  }
  throw new Error(
    `STORAGE_KIND_NOT_SUPPORTED:${(parsed as { kind: string }).kind}`,
  );
}
