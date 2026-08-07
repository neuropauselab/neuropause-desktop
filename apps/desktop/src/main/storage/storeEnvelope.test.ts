/**
 * Phase 8 (RC hardening 8.3) — store envelope tests. Lock the three rules that
 * end the parse-or-reset era: ENOENT is the only "first run"; corrupt files are
 * QUARANTINED with bytes preserved (never silently reset); future-versioned
 * files are set aside intact instead of half-read on a downgrade. Plus the
 * real-store integration: the enterprise record store quarantines a corrupt
 * module file and starts empty, and migration 0002 stamps legacy stores.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STORE_SCHEMA_VERSION,
  envelopeStamp,
  listQuarantinedFiles,
  readStoreFile,
} from './storeEnvelope';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { CURRENT_DATA_VERSION, MIGRATIONS } from '../migration/migrations';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'np-envelope-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('readStoreFile', () => {
  it('a missing file is a FIRST RUN — never a quarantine', async () => {
    const result = await readStoreFile(join(dir, 'nope.json'));
    expect(result.state).toBe('first-run');
    expect(result.quarantinedTo).toBeNull();
  });

  it('a corrupt file is quarantined with bytes preserved, not reset', async () => {
    const path = join(dir, 'store.json');
    await fs.writeFile(path, '{"records": [TRUNCATED');
    const result = await readStoreFile(path, { now: () => 1_700_000_000_000 });
    expect(result.state).toBe('quarantined-corrupt');
    expect(result.data).toBeNull();
    expect(result.quarantinedTo).toContain('.quarantined-');
    // The original bytes survive at the quarantine path; the live path is free.
    expect(await fs.readFile(result.quarantinedTo!, 'utf8')).toContain('TRUNCATED');
    await expect(fs.access(path)).rejects.toThrow();
    expect(await listQuarantinedFiles(dir)).toHaveLength(1);
  });

  it('a NEWER-versioned file is set aside intact (downgrade protection)', async () => {
    const path = join(dir, 'store.json');
    await fs.writeFile(path, JSON.stringify({ schemaVersion: STORE_SCHEMA_VERSION + 1, records: [{ id: 'x' }] }));
    const result = await readStoreFile(path);
    expect(result.state).toBe('quarantined-newer');
    expect(await fs.readFile(result.quarantinedTo!, 'utf8')).toContain('"x"');
  });

  it('legacy files without a stamp read as version 1; stamped files round-trip', async () => {
    const path = join(dir, 'store.json');
    await fs.writeFile(path, JSON.stringify({ records: [{ id: 'legacy' }] }));
    expect((await readStoreFile(path)).state).toBe('loaded');
    await fs.writeFile(path, JSON.stringify({ ...envelopeStamp(), records: [{ id: 'stamped' }] }));
    const stamped = await readStoreFile<{ schemaVersion: number }>(path);
    expect(stamped.state).toBe('loaded');
    expect(stamped.data?.schemaVersion).toBe(STORE_SCHEMA_VERSION);
  });
});

describe('enterprise record store under the envelope', () => {
  it('quarantines a corrupt module store and starts empty — records preserved on disk', async () => {
    const path = join(dir, 'enterprise-module-finance.json');
    await fs.writeFile(path, 'NOT JSON {{{');
    const store = new EnterpriseRecordStore(path, 'finance', 'invoice');
    await store.load();
    expect(store.list()).toHaveLength(0);
    expect(store.quarantinedTo).toContain('.quarantined-');
    expect(await fs.readFile(store.quarantinedTo!, 'utf8')).toBe('NOT JSON {{{');
  });

  it('persists WITH the schema stamp and reloads its own records', async () => {
    const path = join(dir, 'enterprise-module-crm.json');
    const store = new EnterpriseRecordStore(path, 'crm', 'contact');
    await store.load();
    store.create({ title: 'Asha', fields: {}, actor: 't', now: '2026-08-07T00:00:00.000Z' });
    await store.flush();
    const onDisk = JSON.parse(await fs.readFile(path, 'utf8')) as { schemaVersion?: number };
    expect(onDisk.schemaVersion).toBe(STORE_SCHEMA_VERSION);
    const reread = new EnterpriseRecordStore(path, 'crm', 'contact');
    await reread.load();
    expect(reread.list()).toHaveLength(1);
  });
});

describe('migration 0002 — store schema stamp', () => {
  it('is registered, targets data version 2, and stamps legacy stores in place', async () => {
    expect(CURRENT_DATA_VERSION).toBe(2);
    const step = MIGRATIONS.find((m) => m.id === '0002-store-schema-stamp');
    expect(step?.toVersion).toBe(2);
    await fs.writeFile(join(dir, 'enterprise-module-hr.json'), JSON.stringify({ records: [{ id: 'e1' }] }));
    await fs.writeFile(join(dir, 'broken.json'), '{oops'); // untouched, not destroyed
    const logs: string[] = [];
    await step!.up({ dataDir: dir, log: (m: string) => logs.push(m) } as never);
    const stamped = JSON.parse(await fs.readFile(join(dir, 'enterprise-module-hr.json'), 'utf8')) as {
      schemaVersion?: number;
      records: unknown[];
    };
    expect(stamped.schemaVersion).toBe(STORE_SCHEMA_VERSION);
    expect(stamped.records).toHaveLength(1);
    expect(await fs.readFile(join(dir, 'broken.json'), 'utf8')).toBe('{oops');
    expect(logs[0]).toContain('Stamped');
  });
});
