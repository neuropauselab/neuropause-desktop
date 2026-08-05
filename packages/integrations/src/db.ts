/**
 * Database & storage connectors (NCEA 13.0, Phase 3). The relational connector
 * reuses the persistence layer's `SqlDriver` — the SAME seam validated in Phase
 * 12 — so a real query executes against a real Postgres engine here (VERIFIED).
 * MySQL, Snowflake, and BigQuery implement the identical `SqlDriver` in production
 * (their query dialect differs; the interface does not). MongoDB, Redis, S3,
 * Azure Blob, and GCS are object/document stores whose connection configs are
 * defined here and whose live clients are INFRA-PENDING (see the Integration
 * Matrix). No credentials are embedded; they resolve from the Secret Vault.
 */
import type { SqlDriver } from '@neuropause/persistence';

/** A governed relational connector over any SqlDriver (Postgres verified; others via the same interface). */
export class SqlConnector {
  constructor(private readonly driver: SqlDriver) {}

  async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> {
    const res = await this.driver.query<R>(sql, params);
    return res.rows;
  }

  /** A cheap liveness probe. */
  async ping(): Promise<boolean> {
    try {
      const res = await this.driver.query<{ ok: number }>('SELECT 1 AS ok');
      return res.rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }

  dialect(): string {
    return this.driver.dialect;
  }
}

export type StorageKind = 's3' | 'azure-blob' | 'gcs';

export interface ObjectStoreConfig {
  kind: StorageKind;
  bucket: string;
  region?: string;
  endpoint?: string;
  /** Vault refs — never inline credentials. */
  credentialKey: string;
}

/** Build the canonical object URL for a stored key (config only; no live call). */
export function objectUrl(config: ObjectStoreConfig, key: string): string {
  switch (config.kind) {
    case 's3':
      return config.endpoint ? `${config.endpoint}/${config.bucket}/${key}` : `https://${config.bucket}.s3.${config.region ?? 'us-east-1'}.amazonaws.com/${key}`;
    case 'azure-blob':
      return `https://${config.bucket}.blob.core.windows.net/${key}`;
    case 'gcs':
      return `https://storage.googleapis.com/${config.bucket}/${key}`;
  }
}
