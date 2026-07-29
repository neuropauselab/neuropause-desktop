/**
 * Module 1 — Enterprise CRM. Accounts, contacts, leads, opportunities, activities, and sales
 * territories with lifecycle, ownership, and a computed customer-health score. The RUNTIME is
 * live-verified (real in-process operations); the registry starts EMPTY — real customers are
 * business-data-pending and are never fabricated.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';
import { type LeadStage, type OpportunityStage } from './constants';

export interface Account {
  id: string;
  name: string;
  type: string;
  ownerId?: string;
  industry?: string;
  createdAt: number;
}
export interface Contact {
  id: string;
  accountId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  createdAt: number;
}
export interface Lead {
  id: string;
  name: string;
  source: string;
  stage: LeadStage;
  createdAt: number;
}
export interface Opportunity {
  id: string;
  accountId: string;
  name: string;
  amount: number;
  currency: string;
  stage: OpportunityStage;
  closeDate?: number;
  ownerId?: string;
  createdAt: number;
}
export interface Activity {
  id: string;
  subjectId: string;
  kind: 'call' | 'email' | 'meeting' | 'task' | 'note';
  note: string;
  at: number;
}
export interface Territory {
  id: string;
  name: string;
  ownerId?: string;
}

export interface CustomerHealth {
  accountId: string;
  score: number | null; // null = no signals yet (never fabricated)
  signals: { openOpportunities: number; activities: number; wonDeals: number };
  note: string;
}

export class CrmRuntime {
  private readonly accountsMap = new Map<string, Account>();
  private readonly contactsMap = new Map<string, Contact>();
  private readonly leadsMap = new Map<string, Lead>();
  private readonly oppsMap = new Map<string, Opportunity>();
  private readonly activitiesList: Activity[] = [];
  private readonly territoriesMap = new Map<string, Territory>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
  ) {}

  async createAccount(input: { name: string; type?: string; ownerId?: string; industry?: string }): Promise<Account> {
    const a: Account = { id: randomId('acct'), name: input.name, type: input.type ?? 'customer', ...(input.ownerId ? { ownerId: input.ownerId } : {}), ...(input.industry ? { industry: input.industry } : {}), createdAt: this.clock.now() };
    this.accountsMap.set(a.id, a);
    await this.governance.record({ actor: 'system', domain: 'crm', operation: 'account.create', targetId: a.id, evidence: 'live-verified' });
    return a;
  }
  async createContact(input: { firstName: string; lastName: string; accountId?: string; email?: string }): Promise<Contact> {
    const c: Contact = { id: randomId('cont'), firstName: input.firstName, lastName: input.lastName, ...(input.accountId ? { accountId: input.accountId } : {}), ...(input.email ? { email: input.email } : {}), createdAt: this.clock.now() };
    this.contactsMap.set(c.id, c);
    await this.governance.record({ actor: 'system', domain: 'crm', operation: 'contact.create', targetId: c.id, evidence: 'live-verified' });
    return c;
  }
  async createLead(input: { name: string; source?: string }): Promise<Lead> {
    const l: Lead = { id: randomId('lead'), name: input.name, source: input.source ?? 'inbound', stage: 'new', createdAt: this.clock.now() };
    this.leadsMap.set(l.id, l);
    await this.governance.record({ actor: 'system', domain: 'crm', operation: 'lead.create', targetId: l.id, evidence: 'live-verified' });
    return l;
  }
  async advanceLead(id: string, stage: LeadStage): Promise<Lead> {
    const l = this.leadsMap.get(id);
    if (!l) throw new Error(`no lead ${id}`);
    l.stage = stage;
    await this.governance.record({ actor: 'system', domain: 'crm', operation: `lead.${stage}`, targetId: id, evidence: 'live-verified' });
    return l;
  }
  async createOpportunity(input: { accountId: string; name: string; amount: number; currency?: string; closeDate?: number; ownerId?: string }): Promise<Opportunity> {
    const o: Opportunity = { id: randomId('opp'), accountId: input.accountId, name: input.name, amount: input.amount, currency: input.currency ?? 'USD', stage: 'prospecting', ...(input.closeDate ? { closeDate: input.closeDate } : {}), ...(input.ownerId ? { ownerId: input.ownerId } : {}), createdAt: this.clock.now() };
    this.oppsMap.set(o.id, o);
    await this.governance.record({ actor: 'system', domain: 'crm', operation: 'opportunity.create', targetId: o.id, evidence: 'live-verified' });
    return o;
  }
  async advanceOpportunity(id: string, stage: OpportunityStage): Promise<Opportunity> {
    const o = this.oppsMap.get(id);
    if (!o) throw new Error(`no opportunity ${id}`);
    o.stage = stage;
    await this.governance.record({ actor: 'system', domain: 'crm', operation: `opportunity.${stage}`, targetId: id, evidence: 'live-verified' });
    return o;
  }
  async logActivity(input: { subjectId: string; kind: Activity['kind']; note: string }): Promise<Activity> {
    const a: Activity = { id: randomId('act'), subjectId: input.subjectId, kind: input.kind, note: input.note, at: this.clock.now() };
    this.activitiesList.push(a);
    await this.governance.record({ actor: 'system', domain: 'crm', operation: `activity.${input.kind}`, targetId: a.id, evidence: 'live-verified' });
    return a;
  }
  async createTerritory(input: { name: string; ownerId?: string }): Promise<Territory> {
    const t: Territory = { id: randomId('terr'), name: input.name, ...(input.ownerId ? { ownerId: input.ownerId } : {}) };
    this.territoriesMap.set(t.id, t);
    return t;
  }

  /** Real in-process health score from actual signals — null (never fabricated) when there are none. */
  health(accountId: string): CustomerHealth {
    const opps = this.opportunities().filter((o) => o.accountId === accountId);
    const open = opps.filter((o) => !o.stage.startsWith('closed')).length;
    const won = opps.filter((o) => o.stage === 'closed-won').length;
    const acts = this.activitiesList.filter((a) => a.subjectId === accountId).length;
    const total = open + won + acts;
    if (total === 0) return { accountId, score: null, signals: { openOpportunities: 0, activities: 0, wonDeals: 0 }, note: 'no signals yet — health not fabricated' };
    const score = Math.min(100, won * 40 + open * 15 + acts * 5);
    return { accountId, score, signals: { openOpportunities: open, activities: acts, wonDeals: won }, note: 'computed from real in-process signals' };
  }

  accounts(): Account[] { return [...this.accountsMap.values()]; }
  contacts(): Contact[] { return [...this.contactsMap.values()]; }
  leads(): Lead[] { return [...this.leadsMap.values()]; }
  opportunities(): Opportunity[] { return [...this.oppsMap.values()]; }
  activities(): Activity[] { return [...this.activitiesList]; }
  territories(): Territory[] { return [...this.territoriesMap.values()]; }
  counts(): { accounts: number; contacts: number; leads: number; opportunities: number } {
    return { accounts: this.accountsMap.size, contacts: this.contactsMap.size, leads: this.leadsMap.size, opportunities: this.oppsMap.size };
  }
}
