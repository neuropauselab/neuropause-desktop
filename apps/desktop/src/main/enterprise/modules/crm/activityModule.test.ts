import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ACTIVITIES_MODULE_ID,
  LEADS_MODULE_ID,
  OPPORTUNITIES_MODULE_ID,
  activityFromRecord,
  activityStatusOf,
  assessActivityHealth,
  type CrmActivity,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLeadModule } from './leadModule';
import { createOpportunityModule } from './opportunityModule';
import { createActivityModule } from './activityModule';

const T0 = '2026-08-06T00:00:00.000Z';
const T1 = '2026-08-07T12:00:00.000Z';

const proto = (over: Partial<CrmActivity>): CrmActivity => ({
  id: 'a1', subject: 'Demo call', activityType: 'call', direction: 'outbound',
  relatedLeadRef: '', relatedOpportunityRef: '', relatedCustomerRef: '',
  scheduledFor: null, durationMinutes: 0, dueDate: null, priority: 'medium',
  assignedTo: '', completedAt: null, cancelledAt: null, outcome: '',
  createdAt: T0, updatedAt: T0, ...over,
});

describe('activity domain rules (pure)', () => {
  it('derives status from markers — completion wins, then cancellation, else open', () => {
    expect(activityStatusOf(proto({}))).toBe('open');
    expect(activityStatusOf(proto({ cancelledAt: T0 }))).toBe('cancelled');
    expect(activityStatusOf(proto({ completedAt: T0, cancelledAt: T0 }))).toBe('completed');
  });
  it('flags overdue work high, imminent work medium, closed work low', () => {
    const now = Date.parse('2026-08-10T00:00:00.000Z');
    expect(assessActivityHealth(proto({ activityType: 'task', dueDate: '2026-08-08' }), now).level).toBe('high');
    expect(assessActivityHealth(proto({ activityType: 'meeting', scheduledFor: '2026-08-11' }), now).level).toBe('medium');
    expect(assessActivityHealth(proto({ activityType: 'task', dueDate: '2026-09-01' }), now).level).toBe('low');
    expect(assessActivityHealth(proto({ completedAt: T0, dueDate: '2026-08-01' }), now).level).toBe('low');
    const overdue = assessActivityHealth(proto({ dueDate: '2026-08-08' }), now);
    expect(overdue.reason).toContain('past due by 2 days');
  });
});

describe('Activities over real stores — linkage guards, touch wiring, marker lifecycle', () => {
  let dir: string;
  let leads: EnterpriseModule;
  let opps: EnterpriseModule;
  let acts: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-act-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    leads = createLeadModule(join(dir, 'leads.json'));
    opps = createOpportunityModule(join(dir, 'opps.json'), leads.store);
    acts = createActivityModule(join(dir, 'acts.json'), leads.store, opps.store);
    await Promise.all([leads.store.load(), opps.store.load(), acts.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T1,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEADS_MODULE_ID ? leads
        : id === OPPORTUNITIES_MODULE_ID ? opps
        : id === ACTIVITIES_MODULE_ID ? acts
        : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([leads.store.flush(), opps.store.flush(), acts.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const newLead = (): EnterpriseEntity => {
    const v = leads.hooks.validate({
      fields: { name: 'Acme Renewal', company: 'Acme Inc.', dealValue: 25000, stage: 'new', priority: 'high', source: 'referral' },
    });
    if (!v.ok) throw new Error('lead invalid');
    return leads.store.create({ title: 'Acme Renewal', fields: v.values, actor: 't@np', now: T0 });
  };

  const newActivity = async (fields: Record<string, unknown>): Promise<EnterpriseEntity> => {
    const v = acts.hooks.validate({ fields: { subject: 'Demo call', activityType: 'call', ...fields } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = acts.store.create({ title: 'Demo call', fields: v.values, actor: 't@np', now: T0 });
    await acts.hooks.onChange!({ action: 'created', record: rec }, ctx);
    return acts.store.get(rec.id)!;
  };

  it('logging an activity touches the related records — the staleness clocks reset', async () => {
    const lead = newLead();
    expect(lead.updatedAt).toBe(T0);
    await newActivity({ relatedLeadRef: lead.id });
    const touched = leads.store.get(lead.id)!;
    expect(touched.updatedAt).toBe(T1); // the "no activity in N days" clock now reads from real activities
    expect(touched.fields.name).toBe('Acme Renewal'); // touch preserves every field
  });

  it('refuses dangling refs, unscheduled meetings, and forged statuses', async () => {
    expect(acts.hooks.validate({ fields: { subject: 'X', activityType: 'call', relatedLeadRef: 'nope' } }).ok).toBe(false);
    expect(acts.hooks.validate({ fields: { subject: 'X', activityType: 'meeting' } }).ok).toBe(false);
    const forged = acts.hooks.validate({ fields: { subject: 'X', activityType: 'task', status: 'completed' } });
    expect(forged.ok).toBe(true);
    if (forged.ok) expect(forged.values.status).toBe('open'); // status is marker-derived, never user-set
  });

  it('Complete stamps the marker, prompts for a missing outcome, touches, and freezes', async () => {
    const lead = newLead();
    const rec = await newActivity({ relatedLeadRef: lead.id, dueDate: '2026-08-09' });
    const res = await acts.hooks.runAction!('complete', rec, ctx);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    if (res.ok) expect(String(res.message)).toContain('outcome');
    const done = activityFromRecord(acts.store.get(rec.id)!);
    expect(activityStatusOf(done)).toBe('completed');
    expect(done.completedAt).toBe(T1);
    // Immutable history: merged-field edits and further actions are refused.
    const edit = acts.hooks.validate({ fields: { ...acts.store.get(rec.id)!.fields, subject: 'rewrite' } });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(JSON.stringify(edit.errors)).toContain('immutable');
    expect((await acts.hooks.runAction!('cancel', acts.store.get(rec.id)!, ctx)).ok).toBe(false);
  });

  it('Cancel closes without an outcome prompt and leaves related records untouched', async () => {
    const lead = newLead();
    const rec = await newActivity({ relatedLeadRef: lead.id });
    const leadRevBefore = leads.store.get(lead.id)!.rev;
    const res = await acts.hooks.runAction!('cancel', rec, ctx);
    expect(res.ok).toBe(true);
    expect(activityStatusOf(activityFromRecord(acts.store.get(rec.id)!))).toBe('cancelled');
    expect(leads.store.get(lead.id)!.rev).toBe(leadRevBefore); // cancel is not relationship activity
  });

  it('links to opportunities and summarizes deterministically', async () => {
    const lead = newLead();
    const ov = opps.hooks.validate({ fields: { name: 'Acme expansion', amount: 25000, stage: 'prospecting', sourceLeadRef: lead.id } });
    if (!ov.ok) throw new Error('opp invalid');
    const opp = opps.store.create({ title: 'Acme expansion', fields: ov.values, actor: 't@np', now: T0 });
    const rec = await newActivity({ subject: 'Proposal review', activityType: 'meeting', scheduledFor: '2026-08-20', relatedOpportunityRef: opp.id });
    const summary = await acts.hooks.summarize!(rec);
    expect(summary.headline).toBe('Proposal review · Meeting · 2026-08-20');
    expect(summary.model).toBe('none');
    expect(acts.hooks.validate({ fields: { subject: 'X', activityType: 'task', relatedOpportunityRef: 'ghost' } }).ok).toBe(false);
  });
});
