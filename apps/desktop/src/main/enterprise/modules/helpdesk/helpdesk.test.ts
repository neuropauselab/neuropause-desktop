import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  assessTicketHealth,
  deriveCampaignAttribution,
  ticketFromRecord,
  ticketSlaRemainingHours,
  ticketStatusOf,
  type CrmLead,
  type HelpdeskTicket,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createTicketModule } from './ticketModule';
import { createCampaignModule } from '../crm/campaignModule';
import { createLeadModule } from '../crm/leadModule';

const T0 = '2026-08-06T00:00:00.000Z';

const ticket = (over: Partial<HelpdeskTicket>): HelpdeskTicket => ({
  id: 't1', ticketNumber: 'TIC-1', subject: 'App down', customerRef: '', priority: 'high',
  slaHours: 8, category: '', assignee: '', kbRef: '', resolvedAt: null, closedAt: null,
  resolutionNotes: '', createdAt: T0, updatedAt: T0, ...over,
});

const lead = (over: Partial<CrmLead>): CrmLead => ({
  id: 'l1', name: 'Acme', company: '', contactPerson: '', email: '', stage: 'new',
  priority: 'medium', source: 'website', campaign: 'Diwali 2026', dealValue: 10000,
  expectedCloseDate: null, assignedTo: '', leadScore: 0, createdAt: T0, updatedAt: T0, ...over,
});

describe('W5.1 pure engines — SLA clocks and campaign attribution', () => {
  it('derives SLA remaining/breach from priority and creation time', () => {
    const now = Date.parse('2026-08-06T10:00:00.000Z'); // 10h after creation
    expect(ticketSlaRemainingHours(ticket({}), now)).toBe(-2); // 8h SLA breached 2h ago
    expect(assessTicketHealth(ticket({}), now).level).toBe('high');
    expect(assessTicketHealth(ticket({}), now).reason).toContain('BREACHED 2h ago');
    const early = Date.parse('2026-08-06T01:00:00.000Z');
    expect(assessTicketHealth(ticket({}), early).level).toBe('low'); // 7h left of 8
    expect(assessTicketHealth(ticket({}), Date.parse('2026-08-06T06:30:00.000Z')).level).toBe('medium'); // 1.5h ≤ 25%
    // Resolution stops the clock; history keeps the miss.
    const resolvedLate = ticket({ resolvedAt: '2026-08-06T10:00:00.000Z' });
    expect(assessTicketHealth(resolvedLate, Date.parse('2026-08-07T00:00:00.000Z')).reason).toContain('missed by 2h');
  });

  it('attributes leads to campaigns by exact name with honest nulls', () => {
    const a = deriveCampaignAttribution(
      [lead({}), lead({ id: 'l2', stage: 'won', dealValue: 20000 }), lead({ id: 'l3', stage: 'lost' }), lead({ id: 'l4', campaign: 'Other' })],
      'Diwali 2026', 6000,
    );
    expect(a.leads).toBe(3);
    expect(a.openLeads).toBe(1);
    expect(a.won).toBe(1);
    expect(a.wonValue).toBe(20000);
    expect(a.costPerLead).toBe(2000);
    expect(a.winRate).toBe(50);
    const empty = deriveCampaignAttribution([], 'Nothing', 5000);
    expect(empty.costPerLead).toBeNull();
    expect(empty.winRate).toBeNull();
  });
});

describe('Tickets + Campaigns over real stores', () => {
  let dir: string;
  let tickets: EnterpriseModule;
  let leads: EnterpriseModule;
  let campaigns: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-w51-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    tickets = createTicketModule(join(dir, 'tickets.json'));
    leads = createLeadModule(join(dir, 'leads.json'));
    campaigns = createCampaignModule(join(dir, 'campaigns.json'), leads.store);
    await Promise.all([tickets.store.load(), leads.store.load(), campaigns.store.load()]);
    ctx = { actor: () => 't@np', now: () => T0, authorize: () => undefined, moduleFor: () => null, emit: () => undefined };
  });

  afterEach(async () => {
    await Promise.all([tickets.store.flush(), leads.store.flush(), campaigns.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stamps the SLA from priority, resolves, closes-unresolved honestly, freezes', async () => {
    const v = tickets.hooks.validate({ fields: { ticketNumber: 'TIC-1', subject: 'App down', priority: 'urgent' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.slaHours).toBe(4); // stamped, never user-supplied
    const rec = tickets.store.create({ title: 'App down', fields: v.values, actor: 't@np', now: T0 });
    const closed = await tickets.hooks.runAction!('close', rec, ctx);
    expect(closed.ok).toBe(true);
    if (closed.ok) expect(String(closed.message)).toContain('UNRESOLVED');
    expect(ticketStatusOf(ticketFromRecord(tickets.store.get(rec.id)!))).toBe('closed');
    expect(tickets.hooks.validate({ fields: { ...tickets.store.get(rec.id)!.fields, subject: 'edit' } }).ok).toBe(false);
    expect((await tickets.hooks.runAction!('resolve', tickets.store.get(rec.id)!, ctx)).ok).toBe(false);
  });

  it('campaign summaries read LIVE attribution from the real lead store', async () => {
    const lv = leads.hooks.validate({ fields: { name: 'Acme', stage: 'new', dealValue: 10000, priority: 'medium', source: 'website', campaign: 'Diwali 2026' } });
    if (!lv.ok) throw new Error('lead invalid');
    leads.store.create({ title: 'Acme', fields: lv.values, actor: 't@np', now: T0 });
    const cv = campaigns.hooks.validate({ fields: { campaignName: 'Diwali 2026', channel: 'email', budget: 6000 } });
    expect(cv.ok, JSON.stringify('errors' in cv ? cv.errors : {})).toBe(true);
    if (!cv.ok) throw new Error('unreachable');
    const rec = campaigns.store.create({ title: 'Diwali 2026', fields: cv.values, actor: 't@np', now: T0 });
    const summary = await campaigns.hooks.summarize!(rec);
    expect(summary.headline).toContain('1 lead(s)');
    expect(summary.headline).toContain('6,000/lead');
    // Archive freezes the record; a date-inverted campaign is refused.
    expect((await campaigns.hooks.runAction!('archive', rec, ctx)).ok).toBe(true);
    expect(campaigns.hooks.validate({ fields: { ...campaigns.store.get(rec.id)!.fields, budget: 1 } }).ok).toBe(false);
    expect(campaigns.hooks.validate({ fields: { campaignName: 'X', channel: 'email', startDate: '2026-09-01', endDate: '2026-08-01' } }).ok).toBe(false);
  });
});
