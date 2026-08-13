import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CONTRACTS_MODULE_ID,
  CUSTOMERS_MODULE_ID,
  addMonthsClamped,
  contractDatesError,
  contractFromRecord,
  contractRuntimeState,
  assessContractHealth,
  type EnterpriseEntity,
  type SalesContract,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createCustomerModule } from '../crm/customerModule';
import { createContractModule } from './contractModule';

const T0 = '2026-08-06T00:00:00.000Z';

const proto = (over: Partial<SalesContract>): SalesContract => ({
  id: 'c1', contractNumber: 'CTR-1', title: '', customerRef: 'cust', opportunityRef: '',
  contractValue: 120000, currency: 'USD', startDate: '2026-01-01', endDate: '2026-12-31',
  autoRenew: false, renewalTermMonths: 12, status: 'active', activatedAt: T0,
  terminatedAt: null, terminationReason: '', renewedFromRef: '', renewedToRef: '',
  createdAt: T0, updatedAt: T0, ...over,
});

describe('contract domain rules (pure)', () => {
  it('enforces end-after-start and rejects invalid dates', () => {
    expect(contractDatesError('2026-01-01', '2026-12-31')).toBeNull();
    expect(contractDatesError('2026-12-31', '2026-01-01')).toContain('after the start');
    expect(contractDatesError('2026-01-01', '2026-01-01')).toContain('after the start');
    expect(contractDatesError('not-a-date', '2026-01-01')).toContain('Start date');
  });
  it('adds months calendar-exactly with month-end clamping', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29'); // leap year
    expect(addMonthsClamped('2026-12-31', 12)).toBe('2027-12-31');
    expect(addMonthsClamped('2026-08-15', 6)).toBe('2027-02-15');
  });
  it('derives the runtime state from the stored status + the end-date clock', () => {
    const now = Date.parse('2026-08-10T00:00:00.000Z');
    expect(contractRuntimeState(proto({}), now)).toBe('active');
    expect(contractRuntimeState(proto({ endDate: '2026-08-20' }), now)).toBe('expiring');
    expect(contractRuntimeState(proto({ endDate: '2026-08-01' }), now)).toBe('expired');
    expect(contractRuntimeState(proto({ status: 'draft', activatedAt: null }), now)).toBe('draft');
    expect(contractRuntimeState(proto({ status: 'terminated', terminatedAt: T0, endDate: '2026-08-01' }), now)).toBe('terminated');
    expect(assessContractHealth(proto({ endDate: '2026-08-01' }), now).reason).toContain('Expired 9 days ago');
    expect(assessContractHealth(proto({ endDate: '2026-08-20' }), now).reason).toContain('Expires in 10 days');
  });
});

describe('Contracts over real stores — draft guards, marker lifecycle, renewal chain', () => {
  let dir: string;
  let customers: EnterpriseModule;
  let contracts: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;
  let customerId: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-ctr-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    customers = createCustomerModule(join(dir, 'customers.json'));
    contracts = createContractModule(join(dir, 'contracts.json'), customers.store);
    await Promise.all([customers.store.load(), contracts.store.load()]);
    customerId = customers.store.create({ title: 'Acme Inc.', fields: { name: 'Acme Inc.' }, actor: 't@np', now: T0 }).id;
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === CONTRACTS_MODULE_ID ? contracts
        : id === CUSTOMERS_MODULE_ID ? customers
        : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([customers.store.flush(), contracts.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const draft = (over: Record<string, unknown> = {}): EnterpriseEntity => {
    const v = contracts.hooks.validate({
      fields: {
        contractNumber: 'CTR-1', customerRef: customerId, contractValue: 120000,
        currency: 'USD', startDate: '2026-09-01', endDate: '2027-08-31', renewalTermMonths: 12, ...over,
      },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return contracts.store.create({ title: String(v.values.contractNumber), fields: v.values, actor: 't@np', now: T0 });
  };

  it('refuses dangling customers, inverted dates, zero value, and stamps draft status', () => {
    expect(contracts.hooks.validate({ fields: { contractNumber: 'X', customerRef: 'ghost', contractValue: 1, startDate: '2026-01-01', endDate: '2027-01-01' } }).ok).toBe(false);
    expect(contracts.hooks.validate({ fields: { contractNumber: 'X', customerRef: customerId, contractValue: 1, startDate: '2027-01-01', endDate: '2026-01-01' } }).ok).toBe(false);
    expect(contracts.hooks.validate({ fields: { contractNumber: 'X', customerRef: customerId, contractValue: 0, startDate: '2026-01-01', endDate: '2027-01-01' } }).ok).toBe(false);
    const rec = draft();
    expect(contractFromRecord(rec).status).toBe('draft');
  });

  it('activates once, then freezes edits; terminate requires an active contract', async () => {
    const rec = draft();
    expect((await contracts.hooks.runAction!('terminate', rec, ctx)).ok).toBe(false); // drafts don't terminate
    const act = await contracts.hooks.runAction!('activate', rec, ctx);
    expect(act.ok, act.ok ? '' : act.error).toBe(true);
    const live = contractFromRecord(contracts.store.get(rec.id)!);
    expect(live.status).toBe('active');
    expect(live.activatedAt).toBe(T0);
    expect((await contracts.hooks.runAction!('activate', contracts.store.get(rec.id)!, ctx)).ok).toBe(false);
    const edit = contracts.hooks.validate({ fields: { ...contracts.store.get(rec.id)!.fields, contractValue: 1 } });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(JSON.stringify(edit.errors)).toContain('Terminate or Renew');
    const term = await contracts.hooks.runAction!('terminate', contracts.store.get(rec.id)!, ctx);
    expect(term.ok).toBe(true);
    if (term.ok) expect(String(term.message)).toContain('termination reason'); // none recorded → prompted
    const dead = contractFromRecord(contracts.store.get(rec.id)!);
    expect(dead.status).toBe('terminated');
    expect((await contracts.hooks.runAction!('renew', contracts.store.get(rec.id)!, ctx)).ok).toBe(false);
  });

  it('renews an active contract into a linked successor draft with the exact next term', async () => {
    const rec = draft();
    expect((await contracts.hooks.runAction!('renew', rec, ctx)).ok).toBe(false); // activate first
    await contracts.hooks.runAction!('activate', rec, ctx);
    const res = await contracts.hooks.runAction!('renew', contracts.store.get(rec.id)!, ctx);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    if (res.ok) expect(String(res.message)).toContain('CTR-1-R (2027-08-31 → 2028-08-31)');
    const old = contractFromRecord(contracts.store.get(rec.id)!);
    expect(old.renewedToRef).toBeTruthy();
    const successor = contractFromRecord(contracts.store.get(old.renewedToRef)!);
    expect(successor.contractNumber).toBe('CTR-1-R');
    expect(successor.status).toBe('draft'); // renewal terms deserve review before activation
    expect(successor.startDate).toBe('2027-08-31');
    expect(successor.endDate).toBe('2028-08-31');
    expect(successor.renewedFromRef).toBe(rec.id);
    expect(successor.contractValue).toBe(120000);
    // One renewal per contract.
    expect((await contracts.hooks.runAction!('renew', contracts.store.get(rec.id)!, ctx)).ok).toBe(false);
  });

  it('summarizes deterministically with the runtime state and end date', async () => {
    const rec = draft({ contractNumber: 'CTR-9', endDate: '2027-08-31' });
    const summary = await contracts.hooks.summarize!(rec);
    expect(summary.headline).toBe('CTR-9 · draft · 120,000 · ends 2027-08-31');
    expect(summary.model).toBe('none');
  });
});
