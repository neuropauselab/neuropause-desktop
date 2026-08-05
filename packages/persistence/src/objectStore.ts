/**
 * Object storage (NCEA 12.0, Phase 5). Bytes — documents, attachments, evidence
 * files, AI artifacts, reports, export bundles — live in a BlobStore; ONLY
 * metadata lives in Postgres. The BlobStore interface has a real, tested
 * filesystem adapter (content-checksummed, tenant-namespaced on disk); an
 * S3-compatible adapter implements the identical interface for production
 * (infra-pending). ObjectStorage ties bytes to their tenant-scoped metadata row,
 * so a blob can only be read by the tenant that owns it.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Clock } from '@neuropause/cloud-core';
import type { TableRepository } from './repository';

export interface BlobRef {
  key: string;
  size: number;
  checksum: string;
  contentType: string;
  storage: string;
}

export interface BlobStore {
  readonly kind: string;
  put(key: string, data: Uint8Array, contentType?: string): Promise<BlobRef>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<boolean>;
  stat(key: string): Promise<BlobRef | undefined>;
}

/** Sanitize a storage key into a safe relative path (no traversal). */
function safeKey(key: string): string {
  return key.replace(/\.\.+/g, '_').replace(/^\/+/, '').replace(/[^A-Za-z0-9._/-]/g, '_');
}

export class FilesystemBlobStore implements BlobStore {
  readonly kind = 'filesystem';
  constructor(private readonly baseDir: string) {}

  private path(key: string): string {
    return join(this.baseDir, safeKey(key));
  }

  async put(key: string, data: Uint8Array, contentType = 'application/octet-stream'): Promise<BlobRef> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return { key, size: data.byteLength, checksum: createHash('sha256').update(data).digest('hex'), contentType, storage: this.kind };
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch {
      return undefined;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      await rm(this.path(key));
      return true;
    } catch {
      return false;
    }
  }

  async stat(key: string): Promise<BlobRef | undefined> {
    try {
      const s = await stat(this.path(key));
      const data = await this.get(key);
      return { key, size: s.size, checksum: data ? createHash('sha256').update(data).digest('hex') : '', contentType: 'application/octet-stream', storage: this.kind };
    } catch {
      return undefined;
    }
  }
}

export interface BlobMetadata {
  id: string; // == key
  key: string;
  size: number;
  checksum: string;
  contentType: string;
  storage: string;
  kind: string;
  createdAt: number;
}

export interface PutObjectInput {
  contentType?: string;
  kind?: string;
}

export class ObjectStorage {
  constructor(
    private readonly blobs: BlobStore,
    private readonly meta: TableRepository<BlobMetadata>,
    private readonly clock: Clock,
  ) {}

  /** Store bytes (tenant-namespaced) + a metadata row. Bytes never touch Postgres. */
  async put(tenant: string, key: string, data: Uint8Array, opts: PutObjectInput = {}): Promise<BlobMetadata> {
    const ref = await this.blobs.put(`${tenant}/${key}`, data, opts.contentType);
    const metadata: BlobMetadata = {
      id: key,
      key,
      size: ref.size,
      checksum: ref.checksum,
      contentType: ref.contentType,
      storage: ref.storage,
      kind: opts.kind ?? 'document',
      createdAt: this.clock.now(),
    };
    await this.meta.upsert(tenant, metadata);
    return metadata;
  }

  /** Read bytes — only if the tenant owns the metadata row (tenant-safe). */
  async get(tenant: string, key: string): Promise<Uint8Array | undefined> {
    const metadata = await this.meta.get(tenant, key);
    if (!metadata) return undefined;
    return this.blobs.get(`${tenant}/${key}`);
  }

  async stat(tenant: string, key: string): Promise<BlobMetadata | undefined> {
    return (await this.meta.get(tenant, key))?.value;
  }

  async delete(tenant: string, key: string): Promise<boolean> {
    const existed = await this.meta.softDelete(tenant, key);
    if (existed) await this.blobs.delete(`${tenant}/${key}`);
    return existed;
  }

  async list(tenant: string, kind?: string): Promise<BlobMetadata[]> {
    const stored = await this.meta.list(tenant, kind ? { where: [{ field: 'kind', value: kind }] } : {});
    return stored.map((s) => s.value);
  }
}
