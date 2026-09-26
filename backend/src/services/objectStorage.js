/**
 * Vultr Object Storage (S3-compatible) -- used for the ElevenLabs voice cache
 * and nightly SQLite backups. Configured by S3_ENDPOINT, S3_BUCKET,
 * S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (server .env only). If any is
 * missing, storage is simply off: local dev and tests work without it.
 */
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const REQUEST_TIMEOUT_MS = 10000;

function config() {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: process.env.S3_REGION || "us-east-1" };
}

function s3Store(cfg) {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: true,
    // Newer SDKs add CRC checksums to every request by default; S3-compatible
    // stores don't all accept them. Only send them where S3 requires it.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const send = (command) => client.send(command, { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const Bucket = cfg.bucket;

  return {
    bucket: Bucket,

    /** Object body as a Buffer, or null if it doesn't exist. */
    async get(key) {
      try {
        const res = await send(new GetObjectCommand({ Bucket, Key: key }));
        return Buffer.from(await res.Body.transformToByteArray());
      } catch (err) {
        if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async put(key, body, contentType = "application/octet-stream") {
      await send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },

    /** All keys under a prefix, sorted. */
    async list(prefix) {
      const keys = [];
      let token;
      do {
        const res = await send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        for (const obj of res.Contents ?? []) keys.push(obj.Key);
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return keys.sort();
    },

    async remove(keys) {
      if (!keys.length) return;
      await send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
    },

    /** Creates the bucket if it doesn't exist yet. Returns true if it was created. */
    async ensureBucket() {
      try {
        await send(new HeadBucketCommand({ Bucket }));
        return false;
      } catch (err) {
        if (err.$metadata?.httpStatusCode !== 404 && err.name !== "NotFound") throw err;
      }
      await send(new CreateBucketCommand({ Bucket }));
      return true;
    },
  };
}

let override; // tests
let cached;

/** The object store, or null when S3_* isn't configured. */
export function objectStore() {
  if (override !== undefined) return override;
  const cfg = config();
  if (!cfg) return null;
  const signature = `${cfg.endpoint}|${cfg.bucket}|${cfg.accessKeyId}`;
  if (cached?.signature !== signature) cached = { signature, store: s3Store(cfg) };
  return cached.store;
}

/** Tests: replace the store (an object with get/put/list/remove), or pass undefined to reset. */
export function setObjectStoreForTests(store) {
  override = store;
}
