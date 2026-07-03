/**
 * AI Audit Log. An append-only, in-memory ring of records — one per engine call.
 * Each record carries tokens, cost, latency, model, prompt version, context
 * sources, confidence and outcome, but NEVER prompts, context text, responses,
 * or secrets. It is the governance/observability surface for everything the
 * engine does.
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
