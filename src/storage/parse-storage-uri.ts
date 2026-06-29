export type ParsedLocalUri = { kind: "local"; rootDir: string };
export type ParsedS3Uri = { kind: "s3"; bucket: string; prefix: string };
export type ParsedStorageUri = ParsedLocalUri | ParsedS3Uri;

export function parseStorageUri(uri: string): ParsedStorageUri {
  if (uri.startsWith("local://")) {
    return { kind: "local", rootDir: uri.slice("local://".length) };
  }
  if (uri.startsWith("s3://")) {
    const rest = uri.slice("s3://".length);
    const slashIndex = rest.indexOf("/");
    if (
      slashIndex === -1 ||
      slashIndex === 0 ||
      slashIndex === rest.length - 1
    ) {
      throw new Error(`STORAGE_URI_INVALID_S3:${uri}`);
    }
    const bucket = rest.slice(0, slashIndex);
    const prefix = rest.slice(slashIndex + 1);
    return { kind: "s3", bucket, prefix };
  }
  throw new Error(`STORAGE_URI_UNKNOWN_SCHEME:${uri}`);
}
