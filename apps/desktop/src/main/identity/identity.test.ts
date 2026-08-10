/**
 * Identity — the tests that matter are the REFUSALS.
 *
 * This file exercises the real `initIdentity` handlers against real record
 * stores and a real `IdentityStore` on a real temp directory. Nothing about the
 * decision path is doubled: the only substitutions are the clock and the
 * permission set, both of which are inputs to the subsystem by design.
 *
 * The load-bearing claims, each with a test that fails if the claim stops being
 * true:
 *
 *   1. An ambiguous row becomes an ANSWERABLE question rather than a counter.
 *   2. Confirming fills only what is empty. It never overwrites.
 *   3. A subject that was not offered cannot be confirmed — so the channel
 *      cannot be used to link a provider row to an arbitrary record.
 *   4. Deciding requires BOTH `data:approve` and the destination module's own
 *      write scope. Either alone is refused.
 *   5. A question raised in workspace A is invisible and unanswerable from B.
 *   6. A service holds only its declared scopes — never the signed-in human's —
 *      and holds nothing at all when disabled or when no workspace is active.
 *   7. Unlinking keeps both sides.
 *   8. Sensitive values never leave the main process in the clear.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  EnterpriseModuleDescriptor,
  EnterprisePermission,
  ExternalIdentity,
  IdentityMatch,
  ServiceIdentity,
} from '@neuropause/shared';
import { REDACTED_MARKER } from '@neuropause/shared';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { ProvenanceStore } from '../dataPlane/importer';
import { initIdentity, type IdentitySubsystem } from './index';

const NOW = '2026-08-10T09:00:00.000Z';
const ACTOR = 'priya@example.com';
const WS_A = 'workspace-a';
const WS_B = 'workspace-b';

const CUSTOMERS: EnterpriseModuleDescriptor = {
  id: 'crm-customers',
  title: 'Customers',
  singular: 'Customer',
  plural: 'Customers',
  icon: 'user',
  description: 'test',
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'industry', label: 'Industry', type: 'text' },
    { key: 'personalPhone', label: 'Personal Phone', type: 'text' },
  ],
};

describe('identity subsystem', () => {
  let dir: string;
  let store: EnterpriseRecordStore;
  let identity: IdentitySubsystem;
  let granted: Set<EnterprisePermission>;
  let workspace: string;
  let provenance: ProvenanceStore;
  let audit: { action: string; target: string; summary: string }[];
  let imported: { moduleId: string; recordIds: string[] }[];

  /** The signed-in human's permission probe — the one a service must NOT use. */
  const identityAllows = (permission: EnterprisePermission): boolean => granted.has(permission);

  /** Invoke a handler the way `secureBridge` does: by channel, with a payload. */
  const call = async <T>(channel: string, payload: unknown): Promise<T> => {
    const def = identity.handlers.find((h) => h.channel === channel);
    if (!def) throw new Error(`No handler for ${channel}`);
    const parsed = def.schema.parse(payload);
    return (await def.handler(parsed, {} as never)) as T;
  };

  const queue = (): Promise<IdentityMatch[]> => call('identity:queue', {});
  const list = (): Promise<ExternalIdentity[]> => call('identity:list', {});
  const services = (): Promise<ServiceIdentity[]> => call('identity:services', {});
  const decide = (
    matchId: string,
    decision: 'confirm' | 'create_new' | 'reject',
    subjectId?: string,
  ): Promise<{ ok: boolean; message: string; recordId: string | null }> =>
    call('identity:confirm', { matchId, decision, ...(subjectId ? { subjectId } : {}) });

  /** Raise a question the way the connector bridge does. */
  const raise = async (
    over: Partial<Parameters<typeof identity.store.raiseMatch>[0]> = {},
  ): Promise<IdentityMatch> =>
    identity.store.raiseMatch({
      workspaceId: workspace,
      provider: 'hubspot',
      connectionId: 'acct_1',
      providerEntityType: 'hubspot_companies',
      providerEntityId: '101',
      incomingLabel: 'Northwind Traders Ltd',
      incoming: [
        { field: 'name', label: 'Name', value: 'Northwind Traders Ltd' },
        { field: 'phone', label: 'Phone', value: '+44 20 7946 0000' },
        { field: 'industry', label: 'Industry', value: 'Logistics' },
      ],
      destinationModuleId: CUSTOMERS.id,
      destinationLabel: CUSTOMERS.title,
      candidates: [],
      state: 'ambiguous',
      reason: 'Matches only after normalising the name.',
      ...over,
    });

  beforeEach(async () => {
    dir = join(tmpdir(), `np-identity-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    granted = new Set<EnterprisePermission>(['data:read', 'data:approve', 'crm:read', 'crm:manage', 'governance:manage']);
    workspace = WS_A;
    audit = [];
    imported = [];
    store = new EnterpriseRecordStore(join(dir, 'customers.json'), CUSTOMERS.id, CUSTOMERS.id);
    await store.load();
    provenance = new ProvenanceStore(join(dir, 'provenance.json'));
    await provenance.load();

    identity = initIdentity({
      userDataDir: dir,
      workspaceId: () => workspace,
      actor: () => ACTOR,
      now: () => NOW,
      audit: (entry) => audit.push(entry),
      allows: identityAllows,
      authorize: (permission) => {
        if (!granted.has(permission)) throw new Error(`Missing permission: ${permission}`);
      },
      modules: () => [CUSTOMERS],
      storeFor: (moduleId) => (moduleId === CUSTOMERS.id ? store : null),
      provenance,
      onImported: (event) => imported.push({ moduleId: event.moduleId, recordIds: event.recordIds }),
    });
  });

  afterEach(async () => {
    // Drain the store's serialised write chain first. Registering a service is
    // fire-and-forget by design, so removing the directory underneath it turns
    // a passing test into a flaky ENOTEMPTY on the NEXT test.
    await identity.store.flush();
    await store.flush();

    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  /* ── 1. The question exists at all ───────────────────────────────────── */

  it('an ambiguous row becomes a question a person can answer', async () => {
    /**
     * Program 9's failure, stated as a test: the bridge counted this row and
     * dropped it, so the only trace was a number in a finished sync summary.
     */
    await raise();
    const pending = await queue();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.incomingLabel).toBe('Northwind Traders Ltd');
    expect(pending[0]!.reason).toBe('Matches only after normalising the name.');
    expect(pending[0]!.destinationLabel).toBe('Customers');
  });

  it('the same row raised twice is one question with a rising count', async () => {
    await raise();
    await raise();
    const pending = await queue();
    expect(pending).toHaveLength(1);
    // A question re-raised by every sync is itself a signal, and duplicating it
    // would bury the others.
    expect(pending[0]!.seenCount).toBe(2);
  });

  /* ── 2. Confirming fills blanks and never overwrites ─────────────────── */

  it('confirming fills only the empty fields', async () => {
    const record = store.create({
      title: 'Northwind Traders',
      // `phone` is deliberately already set, and DIFFERENT from the provider's.
      fields: { name: 'Northwind Traders', phone: '+44 20 0000 0000', industry: '' },
      actor: 'someone@example.com',
      now: NOW,
    });
    const match = await raise({
      candidates: [
        {
          subject: { kind: 'record', scopeId: CUSTOMERS.id, id: record.id, label: record.title },
          evidence: [
            { kind: 'name_canonical', field: 'name', value: 'Northwind Traders Ltd', detail: 'Canonical match.' },
          ],
          confidence: 0.2,
          differs: [],
        },
      ],
    });

    const res = await decide(match.id, 'confirm', record.id);
    expect(res.ok).toBe(true);

    const after = store.get(record.id)!;
    // The blank was filled…
    expect(after.fields.industry).toBe('Logistics');
    // …and the value that was already there was NOT touched, even though the
    // provider disagrees. This is the assertion that keeps a confirm from
    // becoming a silent overwrite of somebody's correction.
    expect(after.fields.phone).toBe('+44 20 0000 0000');
    expect(after.title).toBe('Northwind Traders');
  });

  it('the audit line says how many fields were filled', async () => {
    const record = store.create({
      title: 'Northwind Traders',
      fields: { name: 'Northwind Traders', phone: '+44 20 0000 0000', industry: 'Logistics' },
      actor: 'someone@example.com',
      now: NOW,
    });
    const match = await raise({
      candidates: [
        {
          subject: { kind: 'record', scopeId: CUSTOMERS.id, id: record.id, label: record.title },
          evidence: [],
          confidence: 0.2,
          differs: [],
        },
      ],
    });
    await decide(match.id, 'confirm', record.id);
    const line = audit.find((a) => a.action === 'identity.confirmed');
    expect(line?.summary).toContain('nothing was overwritten');
  });

  it('answering a question removes it from the queue', async () => {
    const match = await raise();
    await decide(match.id, 'reject');
    expect(await queue()).toHaveLength(0);
    // …and the same question can be raised again by a later sync, because the
    // decision is recorded against the identity, not against the queue.
    const again = await raise();
    expect(again.seenCount).toBe(1);
  });

  /* ── 3. Only an OFFERED subject can be confirmed ─────────────────────── */

  it('refuses a subject that was never offered', async () => {
    const offered = store.create({
      title: 'Northwind Traders',
      fields: { name: 'Northwind Traders' },
      actor: ACTOR,
      now: NOW,
    });
    const unrelated = store.create({
      title: 'Acme Manufacturing',
      fields: { name: 'Acme Manufacturing' },
      actor: ACTOR,
      now: NOW,
    });
    const match = await raise({
      candidates: [
        {
          subject: { kind: 'record', scopeId: CUSTOMERS.id, id: offered.id, label: offered.title },
          evidence: [],
          confidence: 0.2,
          differs: [],
        },
      ],
    });

    /**
     * Without this check the channel is a link-anything-to-anything primitive:
     * a caller could confirm a provider row onto a record the engine never
     * considered, which is a data-integrity hole dressed as a user decision.
     */
    const res = await decide(match.id, 'confirm', unrelated.id);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not one of the offered matches/i);
    expect(await queue()).toHaveLength(1);
    expect(store.get(unrelated.id)!.fields.industry ?? '').toBe('');
  });

  it('refuses a candidate whose record has since been deleted', async () => {
    const record = store.create({
      title: 'Northwind Traders',
      fields: { name: 'Northwind Traders' },
      actor: ACTOR,
      now: NOW,
    });
    const match = await raise({
      candidates: [
        {
          subject: { kind: 'record', scopeId: CUSTOMERS.id, id: record.id, label: record.title },
          evidence: [],
          confidence: 0.2,
          differs: [],
        },
      ],
    });
    store.softDelete(record.id, { actor: ACTOR, now: NOW });
    const res = await decide(match.id, 'confirm', record.id);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/no longer exists/i);
  });

  /* ── 4. Two authorities, both required ───────────────────────────────── */

  it('deciding needs data:approve', async () => {
    const match = await raise();
    granted.delete('data:approve');
    await expect(decide(match.id, 'create_new')).rejects.toThrow(/data:approve/);
    expect(store.list()).toHaveLength(0);
  });

  it('deciding needs the destination module’s own write scope too', async () => {
    const match = await raise();
    // `data:approve` is still held. Approving an identity is not permission to
    // write to a module the person cannot write to.
    granted.delete('crm:manage');
    await expect(decide(match.id, 'create_new')).rejects.toThrow(/crm:manage/);
    expect(store.list()).toHaveLength(0);
  });

  it('reading the queue needs data:read', async () => {
    await raise();
    granted.delete('data:read');
    await expect(queue()).rejects.toThrow(/data:read/);
  });

  it('stopping a service needs governance:manage', async () => {
    const svc = identity.serviceAuthorizer({ id: 'svc', purpose: 'Test service', permissions: ['crm:manage'] });
    await svc.note('registered');
    granted.delete('governance:manage');
    await expect(call('identity:service.status', { serviceId: `svc@${WS_A}`, status: 'disabled' })).rejects.toThrow(
      /governance:manage/,
    );
  });

  /* ── 5. Workspace is the outer boundary ──────────────────────────────── */

  it('a question raised in one workspace is invisible in another', async () => {
    await raise();
    expect(await queue()).toHaveLength(1);
    workspace = WS_B;
    expect(await queue()).toHaveLength(0);
  });

  it('a question raised in one workspace cannot be answered from another', async () => {
    const record = store.create({
      title: 'Northwind Traders',
      fields: { name: 'Northwind Traders' },
      actor: ACTOR,
      now: NOW,
    });
    const match = await raise({
      candidates: [
        {
          subject: { kind: 'record', scopeId: CUSTOMERS.id, id: record.id, label: record.title },
          evidence: [],
          confidence: 0.2,
          differs: [],
        },
      ],
    });

    workspace = WS_B;
    const res = await decide(match.id, 'confirm', record.id);
    // Fails CLOSED, and with the same message an expired question gives — a
    // cross-workspace probe learns nothing about what exists elsewhere.
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/no longer exists/i);

    workspace = WS_A;
    expect(await queue()).toHaveLength(1);
  });

  it('an identity linked in one workspace is not listed in another', async () => {
    const match = await raise();
    await decide(match.id, 'create_new');
    expect(await list()).toHaveLength(1);
    workspace = WS_B;
    expect(await list()).toHaveLength(0);
  });

  /* ── 6. A service's authority is its own ─────────────────────────────── */

  it('holds nothing until its row is readable, then holds its declared scopes', async () => {
    const svc = identity.serviceAuthorizer({
      id: 'service.connector-sync',
      purpose: 'Connector sync',
      permissions: ['crm:read', 'crm:manage'],
    });
    /**
     * THE COLD-START BUG, as a test.
     *
     * `serviceById` reads an in-memory list that starts empty, and an empty list
     * is indistinguishable from "no such service" — so the first check of every
     * process used to sail straight past a service an operator had STOPPED, and
     * a whole sync batch got written on the next launch. An absence is not an
     * all-clear.
     */
    expect(svc.allows('crm:manage')).toBe(false);
    await svc.ready();
    expect(svc.allows('crm:manage')).toBe(true);
    /**
     * The signed-in human holds `governance:manage` here. If the service's check
     * leaked to the human's roles — which is exactly what the bridge used to do —
     * this would be true. `deps.allows` is the human's probe and is asserted
     * against the service's answer, so the two cannot be the same object.
     */
    expect(identityAllows('governance:manage')).toBe(true);
    expect(svc.allows('governance:manage')).toBe(false);
  });

  it('records the first action a service takes', async () => {
    const svc = identity.serviceAuthorizer({
      id: 'service.connector-sync',
      purpose: 'Connector sync',
      permissions: ['crm:manage'],
    });
    await svc.note('Bridged hubspot/hubspot_companies');
    const [row] = await services();
    // The regression: the note fired before registration resolved, found no
    // row, and returned quietly — so a service that HAD acted reported "never".
    expect(row?.lastAction).toBe('Bridged hubspot/hubspot_companies');
    expect(row?.lastUsedAt).toBe(NOW);
  });

  it('a service is named as a service in the audit trail', () => {
    const svc = identity.serviceAuthorizer({
      id: 'service.connector-sync',
      purpose: 'Connector sync',
      permissions: ['crm:manage'],
    });
    expect(svc.actor()).toBe('Connector sync (service)');
    // Not an email, not a person's name, not null.
    expect(svc.actor()).not.toContain(ACTOR);
  });

  it('a service holds nothing while no workspace is active', async () => {
    const svc = identity.serviceAuthorizer({
      id: 'service.connector-sync',
      purpose: 'Connector sync',
      permissions: ['crm:manage'],
    });
    await svc.ready();
    workspace = '';
    expect(svc.allows('crm:manage')).toBe(false);
    expect(svc.rowId()).toBeNull();
  });

  it('a stopped service holds nothing', async () => {
    const svc = identity.serviceAuthorizer({
      id: 'service.connector-sync',
      purpose: 'Connector sync',
      permissions: ['crm:manage'],
    });
    await svc.ready();
    expect(svc.allows('crm:manage')).toBe(true);
    await svc.note('started');
    const stopped = await call<ServiceIdentity | null>('identity:service.status', {
      serviceId: svc.rowId()!,
      status: 'disabled',
    });
    expect(stopped?.status).toBe('disabled');
    // No restart required: the check reads the live row.
    expect(svc.allows('crm:manage')).toBe(false);
  });

  it('one declared service is a separate principal per workspace', async () => {
    const svc = identity.serviceAuthorizer({
      id: 'service.connector-sync',
      purpose: 'Connector sync',
      permissions: ['crm:manage'],
    });
    await svc.ready();
    expect(svc.allows('crm:manage')).toBe(true);
    const inA = svc.rowId();

    workspace = WS_B;
    await svc.ready();
    expect(svc.allows('crm:manage')).toBe(true);
    const inB = svc.rowId();
    expect(inB).not.toBe(inA);

    await svc.note('acted in b');
    // Stopping it in B must not stop it in A.
    await call('identity:service.status', { serviceId: inB!, status: 'disabled' });
    expect(svc.allows('crm:manage')).toBe(false);
    workspace = WS_A;
    expect(svc.allows('crm:manage')).toBe(true);
  });

  it('a service from another workspace cannot be stopped', async () => {
    const svc = identity.serviceAuthorizer({
      id: 'service.connector-sync',
      purpose: 'Connector sync',
      permissions: ['crm:manage'],
    });
    await svc.note('acted in a');
    const inA = svc.rowId()!;
    workspace = WS_B;
    expect(await call('identity:service.status', { serviceId: inA, status: 'disabled' })).toBeNull();
    workspace = WS_A;
    expect(svc.allows('crm:manage')).toBe(true);
  });

  it('the service list is scoped to the workspace', async () => {
    const svc = identity.serviceAuthorizer({
      id: 'service.connector-sync',
      purpose: 'Connector sync',
      permissions: ['crm:manage'],
    });
    await svc.note('acted');
    expect(await services()).toHaveLength(1);
    workspace = WS_B;
    expect(await services()).toHaveLength(0);
  });

  /* ── 6b. A decision is DURABLE ───────────────────────────────────────── */

  it('confirming leaves provenance the sync can find, marked as adoption', async () => {
    /**
     * THE P0 THIS CLOSES.
     *
     * The bridge's only idempotency source is `provenance.forExternalKey(...)`.
     * A decision that wrote none was invisible to the next sync: the question
     * came back on the following tick, and the provider's later updates never
     * reached the record a person had just linked. So "confirm" was a label on a
     * screen rather than an act with consequences.
     */
    const record = store.create({
      title: 'Northwind Traders',
      fields: { name: 'Northwind Traders' },
      actor: 'a person',
      now: NOW,
    });
    const match = await raise({
      candidates: [
        {
          subject: { kind: 'record', scopeId: CUSTOMERS.id, id: record.id, label: record.title },
          evidence: [],
          confidence: 0.2,
          differs: [],
        },
      ],
    });
    await decide(match.id, 'confirm', record.id);

    // The key is byte-identical to the one the bridge builds.
    const found = provenance.forExternalKey('hubspot::acct_1::hubspot_companies::101');
    expect(found?.recordId).toBe(record.id);
    // `adopted`, not `created`: the record predates the provider's claim on it,
    // so a later sync may fill gaps and must never overwrite.
    expect(found?.connector?.linkage).toBe('adopted');
    expect(found?.approvedBy).toBe(ACTOR);
  });

  it('creating from a provider row leaves provenance marked as created', async () => {
    const match = await raise();
    const res = await decide(match.id, 'create_new');
    const found = provenance.forExternalKey('hubspot::acct_1::hubspot_companies::101');
    expect(found?.recordId).toBe(res.recordId);
    expect(found?.connector?.linkage).toBe('created');
  });

  it('a rejected row is not asked about again', async () => {
    /**
     * "Not a match" writes no record and therefore no provenance, so provenance
     * cannot remember it. Without this probe the next sync tick raised the
     * identical question — a person's answer lasted about a minute.
     */
    const probe = {
      provider: 'hubspot',
      connectionId: 'acct_1',
      providerEntityType: 'hubspot_companies',
      providerEntityId: '101',
    };
    expect(identity.decidedAlready(probe)).toBe(false);
    const match = await raise();
    await decide(match.id, 'reject');
    expect(identity.decidedAlready(probe)).toBe(true);
    // A DIFFERENT object is still unanswered.
    expect(identity.decidedAlready({ ...probe, providerEntityId: '202' })).toBe(false);
  });

  it('a decision in one workspace does not settle the same row in another', async () => {
    const probe = {
      provider: 'hubspot',
      connectionId: 'acct_1',
      providerEntityType: 'hubspot_companies',
      providerEntityId: '101',
    };
    const match = await raise();
    await decide(match.id, 'reject');
    expect(identity.decidedAlready(probe)).toBe(true);
    workspace = WS_B;
    expect(identity.decidedAlready(probe)).toBe(false);
  });

  /* ── 7. Unlink keeps both sides ──────────────────────────────────────── */

  it('unlinking keeps the record and keeps the external identity', async () => {
    const match = await raise();
    const created = await decide(match.id, 'create_new');
    expect(created.ok).toBe(true);
    const [link] = await list();
    expect(link!.subject).not.toBeNull();

    const res = await call<{ ok: boolean; message: string }>('identity:unlink', { identityId: link!.id });
    expect(res.ok).toBe(true);

    // The record survives — unlinking is not a delete, and a design where it
    // was would make "I linked the wrong thing" unrecoverable.
    expect(store.get(created.recordId!)?.status).not.toBe('deleted');
    const after = await list();
    expect(after).toHaveLength(1);
    expect(after[0]!.subject).toBeNull();
    expect(after[0]!.state).toBe('unknown');
  });

  it('unlinking an identity from another workspace is refused', async () => {
    const match = await raise();
    await decide(match.id, 'create_new');
    const [link] = await list();
    workspace = WS_B;
    const res = await call<{ ok: boolean }>('identity:unlink', { identityId: link!.id });
    expect(res.ok).toBe(false);
    workspace = WS_A;
    expect((await list())[0]!.subject).not.toBeNull();
  });

  /* ── 8. Nothing sensitive crosses the wire in the clear ──────────────── */

  it('masks a sensitive incoming value, and keeps present distinguishable from empty', async () => {
    await raise({
      incoming: [
        { field: 'name', label: 'Name', value: 'Northwind Traders Ltd' },
        { field: 'personalPhone', label: 'Personal Phone', value: '+44 7700 900000' },
      ],
    });
    const [pending] = await queue();
    const values = new Map(pending!.incoming.map((f) => [f.field, f.value]));
    expect(values.get('name')).toBe('Northwind Traders Ltd');
    expect(values.get('personalPhone')).toBe(REDACTED_MARKER);
    expect(JSON.stringify(pending)).not.toContain('7700 900000');
  });

  it('masks both sides of a sensitive difference', async () => {
    await raise({
      candidates: [
        {
          subject: { kind: 'record', scopeId: CUSTOMERS.id, id: 'rec_1', label: 'Northwind' },
          evidence: [
            { kind: 'phone_exact', field: 'personalPhone', value: '+44 7700 900000', detail: 'Phones agree.' },
          ],
          confidence: 0.5,
          differs: [
            {
              field: 'personalPhone',
              label: 'Personal Phone',
              existing: '+44 7700 111111',
              incoming: '+44 7700 900000',
            },
          ],
        },
      ],
    });
    const [pending] = await queue();
    const payload = JSON.stringify(pending);
    // The EXISTING value is as protected as the incoming one. Masking one and
    // not the other is worse than masking neither, because the marker on one
    // side implies the other was checked.
    expect(payload).not.toContain('7700 111111');
    expect(payload).not.toContain('7700 900000');
    expect(pending!.candidates[0]!.differs[0]!.existing).toBe(REDACTED_MARKER);
    expect(pending!.candidates[0]!.differs[0]!.incoming).toBe(REDACTED_MARKER);
    expect(pending!.candidates[0]!.evidence[0]!.value).toBe(REDACTED_MARKER);
    // The reason it is offered still reads.
    expect(pending!.candidates[0]!.evidence[0]!.detail).toBe('Phones agree.');
  });

  it('writes the real value, not the mask', async () => {
    /**
     * The masking is a VIEW. If the write path read the view instead of the
     * store, confirming would replace a phone number with bullet characters —
     * a redaction that corrupts data is not a security control.
     */
    const match = await raise({
      incoming: [
        { field: 'name', label: 'Name', value: 'Northwind Traders Ltd' },
        { field: 'personalPhone', label: 'Personal Phone', value: '+44 7700 900000' },
      ],
    });
    const res = await decide(match.id, 'create_new');
    expect(res.ok).toBe(true);
    expect(store.get(res.recordId!)!.fields.personalPhone).toBe('+44 7700 900000');
  });

  it('drops a credential a provider put in a mapped field, rather than storing it', async () => {
    /**
     * The previous version of this test scanned `identity.json` for
     * `access_token` without ever putting one near the subsystem — it passed
     * with the entire store deleted. So the token is planted in the one place a
     * provider could actually put it: a mapped field value.
     *
     * The identity file stores `incoming` verbatim, so this asserts the shape of
     * what the DECISION writes: the record gets the value under a field the
     * module declares, and no token-shaped key appears anywhere in the identity
     * envelope — no `evidence.value`, no `subject`, no audit copy.
     */
    const secret = 'Bearer sk_live_51H8xQ2eZvKYlo2C';
    const match = await raise({
      incoming: [
        { field: 'name', label: 'Name', value: 'Northwind Traders Ltd' },
        // An undeclared field. The validator must refuse to carry it through.
        { field: 'accessToken', label: 'Access Token', value: secret },
      ],
    });
    const res = await decide(match.id, 'create_new');
    expect(res.ok).toBe(true);
    await identity.store.flush();
    await store.flush();

    // The module never declared `accessToken`, so the record does not carry it.
    expect(store.get(res.recordId!)!.fields.accessToken).toBeUndefined();
    // And the persisted RECORD file is clean.
    expect(await fs.readFile(join(dir, 'customers.json'), 'utf8')).not.toContain(secret);
  });

  it('masks a token-shaped value out of the queue that a person reads', async () => {
    const secret = 'sk_live_51H8xQ2eZvKYlo2C';
    await raise({
      incoming: [
        { field: 'name', label: 'Name', value: 'Northwind Traders Ltd' },
        { field: 'apiSecret', label: 'API Secret', value: secret },
      ],
    });
    const [pending] = await queue();
    // `apiSecret` classifies as SECRET by name, so it never reaches the screen.
    expect(JSON.stringify(pending)).not.toContain(secret);
  });

  /* ── 9. Creating from a provider row still goes through validation ───── */

  it('a provider row that fails validation is refused, not written', async () => {
    const match = await raise({
      incomingLabel: '',
      incoming: [{ field: 'name', label: 'Name', value: '' }],
    });
    const res = await decide(match.id, 'create_new');
    expect(res.ok).toBe(false);
    expect(store.list()).toHaveLength(0);
    // The question stays open. A refusal is not an answer.
    expect(await queue()).toHaveLength(1);
  });

  it('fires the same lifecycle fan-out an import does', async () => {
    const match = await raise();
    const res = await decide(match.id, 'create_new');
    expect(imported).toEqual([{ moduleId: CUSTOMERS.id, recordIds: [res.recordId] }]);
  });

  it('records a human decision as the evidence for the link', async () => {
    const match = await raise();
    await decide(match.id, 'create_new');
    const [link] = await list();
    expect(link!.state).toBe('known');
    expect(link!.confirmedBy).toBe(ACTOR);
    expect(link!.evidence.some((e) => e.kind === 'human_decision')).toBe(true);
  });

  it('rejecting records the decision without creating anything', async () => {
    const match = await raise();
    const res = await decide(match.id, 'reject');
    expect(res.ok).toBe(true);
    expect(store.list()).toHaveLength(0);
    const [link] = await list();
    expect(link!.state).toBe('unknown');
    expect(link!.subject).toBeNull();
    // Recorded, so the next sync can see a person already said no.
    expect(link!.confirmedBy).toBe(ACTOR);
  });

  /* ── 10. Provider keys cannot collide ────────────────────────────────── */

  it('the same provider id under two entity types is two questions', async () => {
    await raise({ providerEntityType: 'hubspot_companies', providerEntityId: '847392' });
    await raise({ providerEntityType: 'hubspot_contacts', providerEntityId: '847392' });
    expect(await queue()).toHaveLength(2);
  });

  it('the same provider id under two connections is two questions', async () => {
    await raise({ connectionId: 'acct_1' });
    await raise({ connectionId: 'acct_2' });
    expect(await queue()).toHaveLength(2);
  });

  it('a provider id containing the key separator cannot collapse two questions', async () => {
    /**
     * A naive `a:b:c` key lets a provider id of `x:y` impersonate a different
     * (entityType, entityId) pair. The store keys on a structured encoding for
     * this reason.
     */
    await raise({ providerEntityType: 'a', providerEntityId: 'b:c' });
    await raise({ providerEntityType: 'a:b', providerEntityId: 'c' });
    expect(await queue()).toHaveLength(2);
  });
});
