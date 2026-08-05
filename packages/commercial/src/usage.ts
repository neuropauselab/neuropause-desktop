/**
 * Module 6 — Usage Metering. Tracks AI usage, storage, API calls, workflows, documents, workspace
 * activity, and automation runs as REAL per-tenant counters. Nothing is sampled or estimated — a
 * meter reads exactly what was recorded, and 0 when nothing has been recorded.
 */
import type { CommercialGovernance } from './governance';
import { USAGE_METERS, type UsageMeter } from './constants';

export class UsageMetering {
  private readonly meters = new Map<string, number>(); // key: `${tenantId}:${meter}`

  constructor(private readonly governance: CommercialGovernance) {}

  private key(tenantId: string, meter: UsageMeter): string { return `${tenantId}:${meter}`; }

  async record(input: { tenantId: string; meter: UsageMeter; amount?: number; org?: string }): Promise<number> {
    if (!USAGE_METERS.includes(input.meter)) throw new Error(`unknown usage meter: ${input.meter}`);
    const amount = input.amount ?? 1;
    if (amount < 0) throw new Error('usage amount must be non-negative');
    const k = this.key(input.tenantId, input.meter);
    const next = (this.meters.get(k) ?? 0) + amount;
    this.meters.set(k, next);
    await this.governance.record({ actor: 'system', org: input.org ?? '_ops', tenant: input.tenantId, operation: `usage.${input.meter}`, targetId: input.tenantId, evidence: 'live-verified', decision: `+${amount}` });
    return next;
  }

  /** Real recorded usage for a meter — 0, not an estimate, when nothing was recorded. */
  usage(tenantId: string, meter: UsageMeter): number {
    return this.meters.get(this.key(tenantId, meter)) ?? 0;
  }

  breakdown(tenantId: string): Record<UsageMeter, number> {
    const out = {} as Record<UsageMeter, number>;
    for (const m of USAGE_METERS) out[m] = this.usage(tenantId, m);
    return out;
  }
  total(tenantId: string): number {
    return USAGE_METERS.reduce((s, m) => s + this.usage(tenantId, m), 0);
  }
  meteredTenants(): number {
    return new Set([...this.meters.keys()].map((k) => k.split(':')[0])).size;
  }
}
