import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createDatabase } from "@outegro/db";
import { eq, sql } from "drizzle-orm";
import type { StorageConfig } from "../config/config.js";
import { files } from "../db/schema.js";
import type { StoragePort, StoredFile } from "../steps/step-handler.js";

export const STORAGE = Symbol("STORAGE");

export type Storage = StoragePort & { close(): Promise<void> };

const sha256 = (body: Buffer) =>
  createHash("sha256").update(body).digest("hex");

/** Keys of a built CV: cv/{userId}/{applicationId}/{versionId}.pdf and .tex. */
export const cvKeys = (
  userId: string,
  applicationId: string,
  versionId: string,
) => ({
  pdf: `cv/${userId}/${applicationId}/${versionId}.pdf`,
  tex: `cv/${userId}/${applicationId}/${versionId}.tex`,
});

/** S3 API: MinIO locally (path style), Cloudflare R2 later. */
export class S3Storage implements Storage {
  private readonly client: S3Client;
  constructor(private readonly config: StorageConfig) {
    this.client = new S3Client({
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId ?? "",
        secretAccessKey: config.secretAccessKey ?? "",
      },
    });
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<StoredFile> {
    const hash = sha256(body);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: { sha256: hash },
      }),
    );
    return { key, contentType, size: body.length, sha256: hash };
  }

  async get(key: string) {
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      if (!object.Body) return null;
      const bytes = await object.Body.transformToByteArray();
      return {
        body: Buffer.from(bytes),
        contentType: object.ContentType ?? "application/octet-stream",
      };
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async head(key: string): Promise<StoredFile | null> {
    try {
      const object = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return {
        key,
        contentType: object.ContentType ?? "application/octet-stream",
        size: Number(object.ContentLength ?? 0),
        sha256: object.Metadata?.sha256 ?? "",
      };
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async close() {
    this.client.destroy();
  }
}

function missing(error: unknown) {
  const { name, $metadata } = (error ?? {}) as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    name === "NoSuchKey" ||
    name === "NotFound" ||
    $metadata?.httpStatusCode === 404
  );
}

/**
 * Files in PostgreSQL (`files`, bytea) while production has no object
 * storage. Its own small pool, so a worker process can use it too.
 */
export class PgStorage implements Storage {
  private readonly database;
  constructor(url: string) {
    this.database = createDatabase({
      url,
      schema: { files },
      max: 2,
      applicationName: "atelier-storage",
    });
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<StoredFile> {
    const hash = sha256(body);
    await this.database.db
      .insert(files)
      .values({ key, contentType, size: body.length, sha256: hash, data: body })
      .onConflictDoUpdate({
        target: files.key,
        set: {
          contentType,
          size: body.length,
          sha256: hash,
          data: body,
          createdAt: sql`now()`,
        },
      });
    return { key, contentType, size: body.length, sha256: hash };
  }

  async get(key: string) {
    const [row] = await this.database.db
      .select({ data: files.data, contentType: files.contentType })
      .from(files)
      .where(eq(files.key, key));
    return row
      ? { body: Buffer.from(row.data), contentType: row.contentType }
      : null;
  }

  async head(key: string): Promise<StoredFile | null> {
    const [row] = await this.database.db
      .select({
        key: files.key,
        contentType: files.contentType,
        size: files.size,
        sha256: files.sha256,
      })
      .from(files)
      .where(eq(files.key, key));
    return row ?? null;
  }

  async close() {
    await this.database.close();
  }
}

/** In memory, for tests. */
export class MemoryStorage implements Storage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
    return { key, contentType, size: body.length, sha256: sha256(body) };
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async head(key: string) {
    const object = this.objects.get(key);
    return object
      ? {
          key,
          contentType: object.contentType,
          size: object.body.length,
          sha256: sha256(object.body),
        }
      : null;
  }
  async close() {}
}

export function createStorage(
  config: StorageConfig,
  databaseUrl?: string,
): Storage {
  if (config.driver === "s3") return new S3Storage(config);
  if (!databaseUrl) throw new Error("STORAGE_DRIVER=pg needs DATABASE_URL");
  return new PgStorage(databaseUrl);
}
