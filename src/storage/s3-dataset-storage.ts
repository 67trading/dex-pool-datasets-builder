import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  DatasetStorage,
  WriteDatasetObjectInput,
  WrittenDatasetObject,
} from "./dataset-storage.types.js";

export class S3DatasetStorage implements DatasetStorage {
  readonly kind = "s3" as const;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly prefix: string,
  ) {}

  async writeObject(
    input: WriteDatasetObjectInput,
  ): Promise<WrittenDatasetObject> {
    const key = joinS3Key(this.prefix, input.key);
    const body =
      typeof input.body === "string"
        ? Buffer.from(input.body, "utf8")
        : input.body;

    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );

    return {
      key,
      uri: `s3://${this.bucket}/${key}`,
      etag: result.ETag,
      versionId: result.VersionId,
    };
  }

  async readObject(key: string): Promise<Uint8Array> {
    const fullKey = joinS3Key(this.prefix, key);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: fullKey }),
    );
    if (result.Body === undefined) {
      throw new Error(`S3_OBJECT_EMPTY:${fullKey}`);
    }
    // transformToByteArray() is available on S3 response body streams
    return result.Body.transformToByteArray();
  }

  async exists(key: string): Promise<boolean> {
    const fullKey = joinS3Key(this.prefix, key);
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: fullKey }),
      );
      return true;
    } catch (error: unknown) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}

function joinS3Key(prefix: string, key: string): string {
  const cleanPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const cleanKey = key.startsWith("/") ? key.slice(1) : key;
  return `${cleanPrefix}/${cleanKey}`;
}

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  const code = (error as { Code?: string }).Code;
  return name === "NoSuchKey" || name === "NotFound" || code === "404";
}
