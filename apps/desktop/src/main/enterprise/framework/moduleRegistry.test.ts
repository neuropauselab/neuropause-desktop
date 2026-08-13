import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  type EnterpriseModuleDescriptor,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { EnterpriseRecordStore } from './enterpriseRecordStore';
import { defineEnterpriseModule } from './enterpriseModule';
import {
  EnterpriseModuleRegistry,
  buildModuleHandlers,
  notifyImportedRecords,
} from './moduleRegistry';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';

const T0 = '2026-07-08T00:00:00.000Z';

const DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: 'finance',
  title: 'Finance',
  singular: 'Invoice',
  plural: 'Invoices',
  icon: 'database',
  description: 'Test module',
  fields: [
    { key: 'number', label: 'Number', type: 'text', required: true },
    { key: 'amount', label: 'Amount', type: 'number', min: 0 },
    {
      key: 'currency',
      label: 'Currency',
      type: 'select',
      options: [
        { value: 'usd', label: 'USD' },
        { value: 'eur', label: 'EUR' },
      ],
    },
  ],
  titleField: 'number',
  permissions: { read: 'operations:read', write: 'operations:manage' },
};

const paths: string[] = [];

interface Recorded {
  audit: { action: string; target: string; summary: string }[];
  publish: PlatformEventInput[];
  broadcast: { channel: string; payload: unknown }[];
  authorized: EnterprisePermission[];
}

let rec: Recorded;
let deny: EnterprisePermission | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];

function ctx() {
  return {
    authorize: (permission: EnterprisePermission) => {
      rec.authorized.push(permission);
      if (deny === permission) throw new Error(`denied: ${permission}`);
    },
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string, payload: unknown) => rec.broadcast.push({ channel, payload }),
    notify: () => undefined,
    actor: () => 'tester@np.dev',
    now: () => T0,
  };
}

beforeEach(async () => {
  rec = { audit: [], publish: [], broadcast: [], authorized: [] };
  deny = null;
  const path = join(tmpdir(), `np-erp-reg-${randomUUID()}.json`);
  paths.push(path);
  const store = new EnterpriseRecordStore(path, 'finance', 'invoice').bindScope(() => TEST_TENANT_SCOPE);
  await store.load();
  const module = defineEnterpriseModule({ descriptor: DESCRIPTOR, store });
  registry = new EnterpriseModuleRegistry();
  registry.register(module);
  handlers = buildModuleHandlers(registry, ctx());
});

afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function handler(channel: string): (p: unknown) => unknown | Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler;
}

async function createInvoice(fields: Record<string, unknown> = { number: 'INV-1', amount: 100 }) {
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId: 'finance', fields })) as {
    ok: boolean;
    record?: { id: string; title: string; status: string };
    errors?: Record<string, string>;
  };
}

describe('registry', () => {
  it('rejects duplicate module ids', () => {
    const store = new EnterpriseRecordStore(
      join(tmpdir(), `dup-${randomUUID()}.json`),
      'finance',
      'invoice',
    ).bindScope(() => TEST_TENANT_SCOPE);
    expect(() =>
      registry.register(defineEnterpriseModule({ descriptor: DESCRIPTOR, store })),
    ).toThrow(/already registered/);
  });

  it('summaries include descriptor + live counts', async () => {
    await createInvoice();
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{
      id: string;
      recordCount: number;
      activeCount: number;
      permissions: unknown;
    }>;
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: 'finance', recordCount: 1, activeCount: 1 });
    expect(summaries[0].permissions).toEqual({
      read: 'operations:read',
      write: 'operations:manage',
    });
  });
});

describe('create', () => {
  it('validates, persists, titles from titleField, and fans out lifecycle', async () => {
    const res = await createInvoice({ number: 'INV-7', amount: 250, currency: 'usd' });
    expect(res.ok).toBe(true);
    expect(res.record?.title).toBe('INV-7');

    // authorized against the module's WRITE permission
    expect(rec.authorized).toContain('operations:manage');
    // audit + broadcast + a platform event all fired exactly once
    expect(rec.audit).toHaveLength(1);
    expect(rec.audit[0]).toMatchObject({
      action: 'module.finance.created',
      target: res.record?.id,
    });
    expect(rec.broadcast).toHaveLength(1);
    expect(rec.broadcast[0].channel).toBe(IpcChannel.EnterpriseModuleEventBroadcast);
    expect(rec.publish).toHaveLength(1);
    expect(rec.publish[0]).toMatchObject({
      type: 'enterprise.record.created',
      category: 'enterprise',
      source: 'enterprise:finance',
    });
    expect(rec.publish[0].resource).toMatchObject({ type: 'finance', name: 'INV-7' });
  });

  it('rejects a missing required field without persisting or emitting', async () => {
    const res = await createInvoice({ amount: 100 }); // no `number`
    expect(res.ok).toBe(false);
    expect(res.errors?.number).toMatch(/required/i);
    expect(rec.audit).toHaveLength(0);
    expect(rec.publish).toHaveLength(0);
    const list = (await handler(IpcChannel.EnterpriseModuleList)({
      moduleId: 'finance',
    })) as unknown[];
    expect(list).toHaveLength(0);
  });

  it('rejects an invalid select option and out-of-range number', async () => {
    expect((await createInvoice({ number: 'X', currency: 'gbp' })).ok).toBe(false);
    expect((await createInvoice({ number: 'X', amount: -5 })).ok).toBe(false);
  });

  it('fails closed when the write permission is denied — nothing persists', async () => {
    deny = 'operations:manage';
    await expect(createInvoice()).rejects.toThrow(/denied/);
    expect(rec.audit).toHaveLength(0);
    expect(rec.publish).toHaveLength(0);
  });
});

describe('read', () => {
  it('list/get/search authorize against the READ permission', async () => {
    await createInvoice({ number: 'INV-1' });
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'finance' });
    await handler(IpcChannel.EnterpriseModuleGet)({ moduleId: 'finance', id: 'nope' });
    await handler(IpcChannel.EnterpriseModuleSearch)({ moduleId: 'finance', query: 'INV' });
    expect(rec.authorized).toEqual(['operations:read', 'operations:read', 'operations:read']);
  });

  it('denied reads throw', async () => {
    deny = 'operations:read';
    await expect(handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'finance' })).rejects.toThrow(
      /denied/,
    );
  });
});

describe('update / status / delete', () => {
  it('merges an update and emits an updated event', async () => {
    const created = await createInvoice({ number: 'INV-1', amount: 100 });
    const id = created.record?.id as string;
    rec.publish.length = 0;
    const res = (await handler(IpcChannel.EnterpriseModuleUpdate)({
      moduleId: 'finance',
      id,
      fields: { amount: 200 },
    })) as { ok: boolean; record?: { rev: number; fields: Record<string, unknown> } };
    expect(res.ok).toBe(true);
    expect(res.record?.rev).toBe(2);
    expect(res.record?.fields).toMatchObject({ number: 'INV-1', amount: 200 });
    expect(rec.publish[0].type).toBe('enterprise.record.updated');
  });

  it('update of a missing record returns ok:false', async () => {
    const res = (await handler(IpcChannel.EnterpriseModuleUpdate)({
      moduleId: 'finance',
      id: 'ghost',
      fields: { number: 'X' },
    })) as { ok: boolean };
    expect(res.ok).toBe(false);
  });

  it('setStatus emits status_changed; delete soft-deletes and emits deleted', async () => {
    const created = await createInvoice({ number: 'INV-1' });
    const id = created.record?.id as string;

    rec.publish.length = 0;
    await handler(IpcChannel.EnterpriseModuleSetStatus)({
      moduleId: 'finance',
      id,
      status: 'archived',
    });
    expect(rec.publish[0].type).toBe('enterprise.record.status_changed');

    rec.publish.length = 0;
    const del = (await handler(IpcChannel.EnterpriseModuleDelete)({ moduleId: 'finance', id })) as {
      ok: boolean;
      record?: { status: string };
    };
    expect(del.ok).toBe(true);
    expect(del.record?.status).toBe('deleted');
    expect(rec.publish[0].type).toBe('enterprise.record.deleted');
  });
});

describe('unknown module', () => {
  it('throws a clean error for an unregistered module', async () => {
    await expect(handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'ghost' })).rejects.toThrow(
      /Unknown enterprise module/,
    );
  });
});

describe('defineEnterpriseModule', () => {
  it('rejects an inconsistent descriptor', () => {
    const store = new EnterpriseRecordStore(join(tmpdir(), `bad-${randomUUID()}.json`), 'x', 'x').bindScope(() => TEST_TENANT_SCOPE);
    expect(() =>
      defineEnterpriseModule({
        descriptor: { ...DESCRIPTOR, titleField: 'ghostField' },
        store,
      }),
    ).toThrow(/titleField/);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — imported records re-enter the lifecycle.
//
// Before this existed, a Data Plane import wrote straight to the store: the
// records were there, but no audit entry, no renderer broadcast, and no module
// reconciler ever saw them. These lock the replay.
// ---------------------------------------------------------------------------

describe('notifyImportedRecords', () => {
  async function seed(count: number): Promise<string[]> {
    const module = registry.get('finance');
    if (!module) throw new Error('module missing');
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const r = module.store.create({
        title: `INV-${i}`,
        fields: { number: `INV-${i}`, amount: 100 + i },
        actor: 'import',
        now: T0,
      });
      ids.push(r.id);
    }
    await module.store.flush();
    // Only the replay's own effects should be under test.
    rec = { audit: [], publish: [], broadcast: [], authorized: [] };
    return ids;
  }

  it('audits, publishes and broadcasts every imported record', async () => {
    const ids = await seed(3);
    const res = await notifyImportedRecords(registry, ctx(), {
      moduleId: 'finance',
      recordIds: ids,
      correlationId: 'dp_plan_1',
    });

    expect(res.notified).toBe(3);
    expect(res.missing).toBe(0);
    expect(res.failed).toEqual([]);
    expect(rec.audit).toHaveLength(3);
    expect(rec.audit[0]?.action).toBe('module.finance.created');
    expect(rec.publish).toHaveLength(3);
    expect(rec.broadcast.filter((b) => b.channel === IpcChannel.EnterpriseModuleEventBroadcast)).toHaveLength(3);
  });

  it('runs the module’s own onChange reconciler, which an import previously skipped entirely', async () => {
    const seen: { action: string; id: string; correlationId: string | undefined }[] = [];
    const store = new EnterpriseRecordStore(
      join(tmpdir(), `np-erp-reg-${randomUUID()}.json`),
      'finance',
      'invoice',
    ).bindScope(() => TEST_TENANT_SCOPE);
    await store.load();
    const reg = new EnterpriseModuleRegistry();
    reg.register(
      defineEnterpriseModule({
        descriptor: DESCRIPTOR,
        store,
        hooks: {
          onChange: (event, actionCtx) => {
            seen.push({
              action: event.action,
              id: event.record.id,
              correlationId: actionCtx.correlationId,
            });
          },
        },
      }),
    );
    const created = store.create({ title: 'INV-9', fields: { number: 'INV-9' }, actor: 'import', now: T0 });
    await store.flush();

    await notifyImportedRecords(reg, ctx(), {
      moduleId: 'finance',
      recordIds: [created.id],
      correlationId: 'dp_plan_9',
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.action).toBe('created');
    expect(seen[0]?.id).toBe(created.id);
    // The reconciler can tell this was an import, not a person clicking Save.
    expect(seen[0]?.correlationId).toBe('dp_plan_9');
    await fs.rm(store.path ?? '', { force: true }).catch(() => undefined);
  });

  it('reports a record that no longer exists instead of throwing', async () => {
    const ids = await seed(1);
    const res = await notifyImportedRecords(registry, ctx(), {
      moduleId: 'finance',
      recordIds: [...ids, 'rec_does_not_exist'],
      correlationId: 'dp_plan_2',
    });
    expect(res.notified).toBe(1);
    expect(res.missing).toBe(1);
  });

  it('does not fail an already-committed import when a reconciler throws', async () => {
    const store = new EnterpriseRecordStore(
      join(tmpdir(), `np-erp-reg-${randomUUID()}.json`),
      'finance',
      'invoice',
    ).bindScope(() => TEST_TENANT_SCOPE);
    await store.load();
    const reg = new EnterpriseModuleRegistry();
    reg.register(
      defineEnterpriseModule({
        descriptor: DESCRIPTOR,
        store,
        hooks: {
          onChange: () => {
            throw new Error('reconciler exploded');
          },
        },
      }),
    );
    const a = store.create({ title: 'A', fields: { number: 'A' }, actor: 'import', now: T0 });
    const b = store.create({ title: 'B', fields: { number: 'B' }, actor: 'import', now: T0 });
    await store.flush();

    const res = await notifyImportedRecords(reg, ctx(), {
      moduleId: 'finance',
      recordIds: [a.id, b.id],
      correlationId: 'dp_plan_3',
    });

    // Both are reported, neither is silently dropped, and nothing rejected.
    expect(res.failed).toHaveLength(2);
    expect(res.failed[0]?.message).toContain('reconciler exploded');
    expect(res.notified).toBe(0);
  });

  it('returns a clean result for a module that is not registered', async () => {
    const res = await notifyImportedRecords(registry, ctx(), {
      moduleId: 'not-registered',
      recordIds: ['a', 'b'],
      correlationId: 'dp_plan_4',
    });
    expect(res).toEqual({ moduleId: 'not-registered', notified: 0, missing: 2, failed: [] });
  });
});
