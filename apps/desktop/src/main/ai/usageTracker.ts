/**
 * Usage Tracker — the Token Tracker and Cost Tracker in one place. Accumulates
 * tokens and USD cost across calls, broken down by worker and model, for budget
 * and FinOps surfaces. Cost always arrives pre-computed from pricing.ts, the
 * single source of rates.
 */
import type { AiUsageSummary, AiWorkerId } from '@neuropause/shared';
import { registerTenantStore } from '../tenancy/tenantOwnedStore';

interface Bucket {
  calls: number;
  costUsd: number;
}

/** One tenant's running totals. */
interface Totals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  byWorker: Map<string, Bucket>;
  byModel: Map<string, Bucket>;
}

const emptyTotals = (): Totals => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  byWorker: new Map(),
  byModel: new Map(),
});

/**
 * P13C ROUND 6 — USAGE IS ACCUMULATED PER TENANT.
 *
 * These were four bare counters and two Maps on a singleton, and the number came
 * out through `commercial/index.ts` as `aiCostUsd` — one tenant's AI spend on
 * their own Commercial page. It was the install's. Every other input on that page
 * (`graphStore.counts`, `memoryStore.counts`, `billingStore.periodSpend`) is
 * scoped, and the projection cell around it is a `TenantMemo`, so the memo
 * faithfully cached a cross-tenant figure per tenant — isolation machinery
 * working perfectly on a value that had already lost its owner upstream.
 *
 * Low severity: an aggregate, no per-record content. Fixed anyway, because a
 * billing-adjacent number attributed to the wrong customer is wrong in a way that
 * gets acted on, and because `byWorker`/`byModel` name which AI workers another
 * tenant runs.
 *
 * THE SCOPE IS INJECTED, NEVER IMPORTED. Importing `activeTenantScope` here would
 * drag `app.getPath` into this file's node tests — a trap this program has hit in
 * every round.
 *
 * UNBOUND OR UNRESOLVED, `add()` accumulates into a shared `''` partition instead
 * of throwing. That is a DEVIATION from this program's "writes throw" rule and it
 * is deliberate, not an oversight: `add()` is called from inside a completed AI
 * call, and throwing there would turn an accounting gap into a failed user
 * request. The cost is stated rather than hidden — usage produced with no active
 * organization is UNATTRIBUTED and is read back by nobody, so the failure mode is
 * lost accounting, never another tenant's number. The class is registered with
 * the startup gate so an unbound tracker cannot ship unnoticed.
 */
export class UsageTracker {
  private readonly byTenant = new Map<string, Totals>();
  private scope: () => { tenantId: string } | null = () => null;

  constructor() {
    // P13C Round 6 — declared to the startup gate. Without this the class defines
    // a `bindScope` the gate cannot see, so an UNBOUND tracker would ship in
    // silence — the precise thing `assertAllTenantStoresBound()` exists to stop.
    registerTenantStore('ai-usage', () => this.bound);
  }

  private bound = false;

  /** Bind the tenant boundary. Chainable. */
  bindScope(source: () => { tenantId: string } | null): this {
    this.scope = source;
    this.bound = true;
    return this;
  }

  private bucket(): Totals {
    const key = this.scope()?.tenantId ?? '';
    const existing = this.byTenant.get(key);
    if (existing) return existing;
    const fresh = emptyTotals();
    this.byTenant.set(key, fresh);
    return fresh;
  }

  add(p: {
    worker: AiWorkerId;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): void {
    const t = this.bucket();
    t.calls++;
    t.inputTokens += p.inputTokens;
    t.outputTokens += p.outputTokens;
    t.costUsd += p.costUsd;
    bump(t.byWorker, p.worker, p.costUsd);
    bump(t.byModel, p.model, p.costUsd);
  }

  /** THE CALLER'S usage. Never the install's. */
  summary(): AiUsageSummary {
    const t = this.bucket();
    return {
      calls: t.calls,
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      costUsd: round(t.costUsd),
      byWorker: toObj(t.byWorker),
      byModel: toObj(t.byModel),
    };
  }
}

function bump(m: Map<string, Bucket>, key: string, cost: number): void {
  const e = m.get(key) ?? { calls: 0, costUsd: 0 };
  e.calls++;
  e.costUsd = round(e.costUsd + cost);
  m.set(key, e);
}

function toObj(m: Map<string, Bucket>): Record<string, Bucket> {
  const o: Record<string, Bucket> = {};
  for (const [k, v] of m) o[k] = v;
  return o;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
