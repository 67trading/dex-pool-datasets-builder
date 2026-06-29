export type DatasetStorageKind = "local" | "s3";

export type WriteDatasetObjectInput = {
  key: string;
  body: string | Uint8Array;
  contentType?: string;
  metadata?: Record<string, string>;
};

export type WrittenDatasetObject = {
  key: string;
  uri: string;
  sizeBytes?: number;
  checksumSha256?: string;
  etag?: string;
  versionId?: string;
};

export interface DatasetStorage {
  readonly kind: DatasetStorageKind;
  writeObject(input: WriteDatasetObjectInput): Promise<WrittenDatasetObject>;
  readObject?(key: string): Promise<Uint8Array>;
  exists?(key: string): Promise<boolean>;
}
