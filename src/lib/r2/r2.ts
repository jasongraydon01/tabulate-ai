import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { retryR2Operation } from './retry';

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (s3Client) return s3Client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 credentials not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in .env.local"
    );
  }

  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return s3Client;
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME is not set in .env.local");
  }
  return bucket;
}

/**
 * Build an org-scoped storage key.
 * Pattern: {orgId}/{projectId}/{subpath}/{filename}
 */
export function buildKey(
  orgId: string,
  projectId: string,
  subpath: string,
  filename: string
): string {
  return `${orgId}/${projectId}/${subpath}/${filename}`;
}

/**
 * Upload a file to R2 with automatic retry on transient failures.
 * Retries up to 3 times with exponential backoff (1s → 2s → 4s).
 */
export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string
): Promise<void> {
  await retryR2Operation(
    () => getClient().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    ),
    { label: key },
  );
}

/**
 * Download a file from R2 as a Buffer.
 */
export async function downloadFile(key: string): Promise<Buffer> {
  const response = await getClient().send(
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );

  const stream = response.Body;
  if (!stream) {
    throw new Error(`No body returned for key: ${key}`);
  }

  // Convert readable stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Generate a presigned download URL.
 * Default expiry: 1 hour (3600 seconds).
 * Optionally sets ResponseContentDisposition so the browser saves with a friendly filename.
 */
export async function getSignedDownloadUrl(
  key: string,
  expiresInSeconds: number = 3600,
  responseContentDisposition?: string,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ...(responseContentDisposition && { ResponseContentDisposition: responseContentDisposition }),
  });

  return await getSignedUrl(getClient(), command, {
    expiresIn: expiresInSeconds,
  });
}

/**
 * Delete a file from R2.
 */
export async function deleteFile(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );
}

/**
 * List files under a prefix in R2.
 * Returns an array of object keys.
 */
export async function listFiles(prefix: string): Promise<string[]> {
  const response = await getClient().send(
    new ListObjectsV2Command({
      Bucket: getBucket(),
      Prefix: prefix,
    })
  );

  return (response.Contents ?? [])
    .map((obj) => obj.Key)
    .filter((key): key is string => key !== undefined);
}

/**
 * List ALL files under a prefix in R2, handling pagination.
 * Use this instead of listFiles when the result set may exceed 1000 objects.
 */
export async function listAllFiles(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await getClient().send(
      new ListObjectsV2Command({
        Bucket: getBucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of response.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return keys;
}

/**
 * Delete all files under a prefix in R2 (batch delete, 1000 per call).
 * Best-effort: logs errors but does not throw.
 * Returns the number of files deleted and errors encountered.
 *
 * Safety: prefix must be org-scoped (contains at least one `/` and is
 * sufficiently long) to prevent accidental wide-scope deletion.
 */
export async function deletePrefix(
  prefix: string
): Promise<{ deleted: number; errors: number }> {
  // Safety guard: refuse dangerously broad prefixes
  if (!prefix || !prefix.includes('/') || prefix.length < 5) {
    throw new Error(
      `deletePrefix: refusing dangerous prefix "${prefix}" — must be org-scoped (e.g., "orgId/projectId/")`
    );
  }

  const keys = await listAllFiles(prefix);
  if (keys.length === 0) return { deleted: 0, errors: 0 };

  let deleted = 0;
  let errors = 0;
  const BATCH_SIZE = 1000;

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    try {
      const response = await getClient().send(
        new DeleteObjectsCommand({
          Bucket: getBucket(),
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      // With Quiet: true, only errors are returned (not successes).
      // Check for individual object failures.
      const batchErrors = response.Errors?.length ?? 0;
      deleted += batch.length - batchErrors;
      errors += batchErrors;
      if (batchErrors > 0) {
        console.error(
          `[R2] deletePrefix: ${batchErrors} object(s) failed in batch (prefix=${prefix}):`,
          response.Errors
        );
      }
    } catch (err) {
      console.error(
        `[R2] deletePrefix batch error (prefix=${prefix}, batch=${i / BATCH_SIZE}):`,
        err
      );
      errors += batch.length;
    }
  }

  return { deleted, errors };
}
