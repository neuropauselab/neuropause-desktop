/**
 * EPIC 8 — Audit & Forensics. An immutable audit timeline, an investigation workspace, an evidence
 * registry, chain of custody, event correlation, and a security timeline. This REUSES the ONE hash-linked
 * audit ledger: the timeline is the ledger's real `list()`, integrity is the ledger's real `verify()`,
 * and the chain of custody is the ledger's real `provenance()` id-lineage. Correlation and the security
 * timeline are real computations over those entries. Nothing is fabricated — if the ledger is empty, the
 * timeline is empty.
 */
import { randomId } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { TrustGovernance } from './governance';

export interface TimelineEntry {
  auditId: string;
  actor: string;
  action: string;
  target: string;
  at: number;
}
export interface Investigation {
  id: string;
  title: string;
  subject: string;
  evidence: EvidenceItem[];
  open: boolean;
}
export interface EvidenceItem {
  id: string;
  reference: string;
  description: string;
  custody: string[];
}
export interface CorrelationResult {
  byActor: Array<{ actor: string; events: number }>;
  total: number;
}

export class AuditForensics {
  private readonly investigations = new Map<string, Investigation>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly gov: TrustGovernance,
    private readonly operator: string,
  ) {}

  /** The immutable audit timeline — the reused ledger's real, hash-linked entries. */
  timeline(filter: { actor?: string; actionPrefix?: string } = {}): TimelineEntry[] {
    return this.runtime
      .audit()
      .list()
      .filter((e) => (filter.actor ? e.actor === filter.actor : true))
      .filter((e) => (filter.actionPrefix ? e.action.startsWith(filter.actionPrefix) : true))
      .map((e) => ({ auditId: String(e.auditId), actor: e.actor, action: e.action, target: e.target, at: e.at }));
  }

  /** Integrity verification — the reused ledger's real tamper-evident check. */
  verifyIntegrity(): { valid: boolean; brokenAt: number | null; reason?: string } {
    const r = this.runtime.audit().verify();
    return { valid: r.valid, brokenAt: r.brokenAt, ...(r.reason ? { reason: r.reason } : {}) };
  }

  /** Chain of custody — the reused ledger's real provenance id-lineage from root to head. */
  chainOfCustody(): string[] {
    return this.runtime.audit().provenance().map((id) => String(id));
  }

  /** Event correlation — a real grouping of ledger entries by actor. */
  correlate(actionPrefix = 'trust.'): CorrelationResult {
    const entries = this.runtime.audit().list().filter((e) => e.action.startsWith(actionPrefix));
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.actor, (counts.get(e.actor) ?? 0) + 1);
    const byActor = [...counts.entries()].map(([actor, events]) => ({ actor, events })).sort((a, b) => b.events - a.events);
    return { byActor, total: entries.length };
  }

  async openInvestigation(input: { title: string; subject: string }): Promise<Investigation> {
    const inv: Investigation = { id: randomId('inv'), title: input.title, subject: input.subject, evidence: [], open: true };
    this.investigations.set(inv.id, inv);
    await this.gov.record({ actor: this.operator, environment: '_forensics', resource: input.subject, policy: 'investigation', epic: 'E8', operation: 'open-investigation', targetId: inv.id, evidence: 'live-verified', decision: 'open' });
    return inv;
  }

  /** Register evidence (a REFERENCE) into an investigation, starting a custody chain. */
  async addEvidence(investigationId: string, input: { reference: string; description: string; custodian: string }): Promise<EvidenceItem> {
    const inv = this.investigations.get(investigationId);
    if (!inv) throw new Error(`unknown investigation: ${investigationId}`);
    const item: EvidenceItem = { id: randomId('evi'), reference: input.reference, description: input.description, custody: [input.custodian] };
    inv.evidence.push(item);
    await this.gov.record({ actor: input.custodian, environment: '_forensics', resource: input.reference, policy: 'chain-of-custody', epic: 'E8', operation: 'add-evidence', targetId: item.id, evidence: 'live-verified', decision: 'collected' });
    return item;
  }

  async transferCustody(investigationId: string, evidenceId: string, toCustodian: string): Promise<EvidenceItem> {
    const inv = this.investigations.get(investigationId);
    if (!inv) throw new Error(`unknown investigation: ${investigationId}`);
    const item = inv.evidence.find((e) => e.id === evidenceId);
    if (!item) throw new Error(`unknown evidence: ${evidenceId}`);
    item.custody.push(toCustodian);
    await this.gov.record({ actor: toCustodian, environment: '_forensics', resource: item.reference, policy: 'chain-of-custody', epic: 'E8', operation: 'transfer-custody', targetId: evidenceId, evidence: 'live-verified', decision: `custody:${item.custody.length}` });
    return item;
  }

  investigation(id: string): Investigation | undefined {
    return this.investigations.get(id);
  }
  investigationCount(): number {
    return this.investigations.size;
  }
}
