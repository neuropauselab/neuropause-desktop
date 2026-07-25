/**
 * AI Audit Log. A bounded, in-memory ring of records (the newest `cap` are kept;
 * older ones roll off) — one per engine call. Ephemeral by design: it is an
 * in-process observability surface, not a durable audit trail, so it carries no
 * on-disk integrity chain (unlike the persisted governance/gateway audit logs).
 * Each record carries tokens, cost, latency, model, prompt version, context
 * sources, confidence and outcome, but NEVER prompts, context text, responses,
 * or secrets.
 */
import type { AiAuditRecord } from '@neuropause/shared';

export class AiAuditLog {
  private readonly records: AiAuditRecord[] = [];
  private readonly cap: number;
  constructor(cap = 1000) {
    this.cap = cap;
  }
  record(r: AiAuditRecord): void {
    this.records.push(r);
    if (this.records.length > this.cap) {
      this.records.splice(0, this.records.length - this.cap);
    }
  }
  all(): readonly AiAuditRecord[] {
    return this.records;
  }
  recent(n: number): AiAuditRecord[] {
    return this.records.slice(-n).reverse();
  }
  count(): number {
    return this.records.length;
  }
}
