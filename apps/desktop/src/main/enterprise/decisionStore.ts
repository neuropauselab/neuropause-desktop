/**
 * Decision Store (V3.3).
 *
 * Persists first-class executive decisions. Mirrors the existing HealthHistoryStore
 * JSON pattern (injected path, atomic write, 0o600) and is Electron-free by
 * construction, so it unit-tests without a runtime. It does NOT duplicate any
 * intelligence — decisions are created from existing recommendations (or manually)
 * and this store only persists + transitions them.
 */
import { promises as fs, readFileSync } from 'node:fs';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../tenancy/tenantOwnedStore';
import type { TenantReadGrant } from '../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../tenancy/storeScope';
import { dirname } from 'node:path';
import type {
  DecisionCategory,
  DecisionEvent,
  DecisionStatus,
  DecisionSummaryView,
  ExecutiveDecision,
  ExecutiveRecommendation,
} from '@neuropause/shared';
import { isOverdue, isStale } from '@neuropause/shared';

/**
 * P13C ROUND 10 — the structural scope declaration. See tenancy/storeScope.ts.
 *
 * `new TenantOwnership(...)` satisfied the scope gate and cannot express a
 * retention policy, so nothing had ever asked this store what a removal reaches.
 */
declareStoreScope({
  name: 'executive-decisions',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  /** The cap runs inside `create`, under the creating tenant's own resolved scope. */
  retentionAuthority: 'OWNER',
  retention:
    'ONE removal: the MAX_DECISIONS=500 cap in `create`, applied through ' +
    "`TenantOwnership.pruneOwn` — filtered to `scope.tenantId`, oldest-by-`createdAt` within that " +
    'tenant, every other tenant\'s rows returned untouched, and NOTHING pruned when the scope is ' +
    "unresolved. It was an install-wide 500 that let one tenant evict another's decisions " +
    '(Round 2 — H2). There is no delete path at all: `setStatus` transitions to `archived` (a ' +
    'status, not a deletion) after a scoped `get`, and `d.history` grows unbounded by design ' +
    'because a decision trail that silently loses its oldest events is not a trail.',
  reason:
    'ExecutiveDecision carries description, reasoning, evidence[], businessImpact and owner — ' +
    'tenant content in the plainest sense — and it reached a channel on the PUBLIC allowlist ' +
    'before Round 2.',
});

interface DecisionFile {
  decisions: ExecutiveDecision[];
}

const MAX_DECISIONS = 500;

/** Valid lifecycle transitions (STEP 3). */
const TRANSITIONS: Record<DecisionStatus, DecisionStatus[]> = {
  draft: ['suggested', 'accepted', 'rejected', 'archived'],
  suggested: ['accepted', 'rejected', 'archived'],
  accepted: ['in_progress', 'blocked', 'completed', 'rejected', 'archived'],
  in_progress: ['blocked', 'completed', 'rejected', 'archived'],
  blocked: ['in_progress', 'rejected', 'archived'],
  completed: ['archived'],
  rejected: ['archived'],
  archived: [],
};

export function canTransition(from: DecisionStatus, to: DecisionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Map a recommendation's metric to a decision category. Pure. */
function categoryForMetric(metric: string): DecisionCategory {
  switch (metric) {
    case 'engineering':
      return 'engineering';
    case 'governance':
      return 'governance';
    case 'adoption':
    case 'aiUsage':
      return 'growth';
    case 'connectorHealth':
    case 'reliability':
    case 'licenseHealth':
      return 'operations';
    default:
      return 'other';
  }
}

/**
 * Build a draft decision from a recommendation (STEP 7 — traceability). Pure; the
 * caller persists it. Status starts 'suggested' since it came from the engine.
 */
export function decisionFromRecommendation(
  rec: ExecutiveRecommendation,
  nowIso: string,
  idSuffix: string,
): ExecutiveDecision {
  return {
    id: `dec:${idSuffix}`,
    title: rec.recommendedAction,
    category: categoryForMetric(rec.metric),
    description: rec.problem,
    reasoning: rec.rootCause,
    evidence: [...rec.evidence],
    sourceSystems: [...rec.sourceSystems],
    confidence: rec.confidence,
    businessImpact: rec.businessImpact,
    expectedOutcome: rec.expectedOutcome,
    owner: rec.owner,
    priority: rec.priority,
    status: 'suggested',
    createdAt: nowIso,
    updatedAt: nowIso,
    fromRecommendationId: rec.id,
    relatedMetrics: [rec.metric],
    history: [
      {
        at: nowIso,
        actor: 'system',
        kind: 'created',
        newState: 'suggested',
        reason: 'Created from recommendation.',
      },
    ],
  };
}

const IMPACT_RANK: Record<ExecutiveDecision['priority'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Build the compact section view (STEP 6). Pure over a decision list. */
export function summarizeDecisions(
  decisions: ExecutiveDecision[],
  nowMs: number = Date.now(),
): DecisionSummaryView {
  const active = decisions.filter((d) => d.status !== 'archived');
  const pending = active.filter((d) => d.status === 'suggested' || d.status === 'draft').length;
  const accepted = active.filter(
    (d) => d.status === 'accepted' || d.status === 'in_progress',
  ).length;
  const completed = active.filter((d) => d.status === 'completed').length;
  const rejected = active.filter((d) => d.status === 'rejected').length;
  const overdue = active.filter((d) => isOverdue(d, nowMs)).length;
  const blocked = active.filter((d) => d.status === 'blocked').length;
  const stale = active.filter((d) => isStale(d, nowMs)).length;
  const top = [...active]
    .sort((a, b) => {
      const p = IMPACT_RANK[b.priority] - IMPACT_RANK[a.priority];
      if (p !== 0) return p;
      return b.createdAt < a.createdAt ? -1 : 1; // newer first
    })
    .slice(0, 6);
  return {
    total: active.length,
    pending,
    accepted,
    completed,
    rejected,
    overdue,
    blocked,
    stale,
    top,
  };
}

export class DecisionStore {
  /**
   * P13C Round 2 — H2. THE TENANT BOUNDARY.
   *
   * `ExecutiveDecision` carries `description`, `reasoning`, `evidence[]`,
   * `businessImpact` and `owner` — it is tenant content in the plainest sense —
   * and `all()` returned every organization's through a channel on the PUBLIC
   * allowlist. `setStatus` transitioned by bare payload id, and an install-wide
   * 500 cap let one tenant evict another's decisions.
   */
  private readonly tenancy = new TenantOwnership('executive-decisions');
  private decisions: ExecutiveDecision[] = [];
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DecisionFile>;
      this.decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
    } catch {
      this.decisions = [];
    }
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const file: DecisionFile = { decisions: this.decisions };
    await fs.mkdir(dirname(this.filePath), { recursive: true }).catch(() => {});
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */

  /**
   * F22 TENANT ARCHIVE SEAM. P13C ROUND 15.
   *
   * The pair a `TenantDomainSource` adapter needs, living ON the store because
   * the store owns its collection and its serialization — an adapter reaching
   * into a private field from outside would be a second copy of that knowledge,
   * and the two would drift.
   *
   * BOTH TAKE A `TenantReadGrant`, which cannot be constructed literally and is
   * only minted by `authorizeTenantRead`. So this is not an unscoped read that
   * anybody can call: it is a read whose authority is in its type. `onlyMine`
   * stays the seam for every ordinary caller.
   */
  snapshotForGrant(grant: TenantReadGrant): ExecutiveDecision[] {
    this.load();
    return this.tenancy.onlyFor(grant, this.decisions).map((r) => structuredClone(r));
  }

  /**
   * Replace this tenant's rows, leaving every other tenant's byte-identical.
   *
   * ORDER IS PRESERVED for the rows that stay: other tenants keep their relative
   * positions and the restored rows are appended in archive order. Decision order is not semantically meaningful; `all()` sorts on read.
   *
   * The in-memory collection is updated BEFORE the write, because `persist()`
   * serializes from memory — a disk-only merge would be erased by the next
   * ordinary write, which is the hazard `requiresRestart` exists to flag.
   */
  async mergeForGrant(grant: TenantReadGrant, rows: readonly ExecutiveDecision[]): Promise<number> {
    this.load();
    const others = this.decisions.filter((r) => r.tenantId !== grant.tenantId);
    const mine = rows.map((r) => structuredClone(r) as ExecutiveDecision);
    this.decisions = [...others, ...mine];
    await this.persist();
    return mine.length;
  }

  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  /** Unscoped ownership counts, for the migration inventory only. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    this.load();
    return this.tenancy.countOwnership(this.decisions);
  }

  /** The CALLER'S decisions, newest first. Was every decision on the install. */
  all(): ExecutiveDecision[] {
    this.load();
    return this.tenancy
      .onlyMine(this.decisions)
      .sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
  }

  /** The decision, IF it is the caller's. A foreign id reads as absent. */
  get(id: string): ExecutiveDecision | null {
    this.load();
    const d = this.decisions.find((x) => x.id === id) ?? null;
    return d !== null && this.tenancy.mine(d) ? d : null;
  }

  /** Persist a new decision (deduped by id; last write wins). */
  async create(decision: ExecutiveDecision): Promise<ExecutiveDecision> {
    this.load();
    // Owner from the resolved tenant; an existing row only replaceable by its
    // owner, or `create` is a write-side IDOR keyed on a decision id.
    const idx = this.decisions.findIndex((d) => d.id === decision.id);
    if (idx >= 0 && !this.tenancy.mine(this.decisions[idx]!)) return decision;
    const owned = this.tenancy.stamp(decision);
    if (idx >= 0) this.decisions[idx] = owned;
    else this.decisions.push(owned);
    // Retention PER TENANT — an install-wide cap let one tenant choose which of
    // another's decisions was destroyed.
    this.decisions = this.tenancy.pruneOwn(this.decisions, MAX_DECISIONS, (a, b) =>
      a.createdAt < b.createdAt ? -1 : 1,
    );
    await this.persist();
    return owned;
  }

  /**
   * Transition a decision's status if the transition is legal. Returns the updated
   * decision, or null if not found / illegal transition.
   */
  async setStatus(
    id: string,
    to: DecisionStatus,
    nowIso: string,
    opts?: { actor?: string; reason?: string },
  ): Promise<ExecutiveDecision | null> {
    this.load();
    const d = this.get(id); // scoped: a foreign id is not found
    if (!d) return null;
    if (d.status === to) return d;
    if (!canTransition(d.status, to)) return null;
    const previousState = d.status;
    d.status = to;
    d.updatedAt = nowIso;
    // V3.6: terminal + blocked side-effects.
    if (to === 'completed') d.completedAt = nowIso;
    if (to === 'archived') d.archivedAt = nowIso;
    if (to === 'blocked' && opts?.reason) d.blockedReason = opts.reason;
    if (to !== 'blocked') d.blockedReason = undefined;
    // V3.6: append a history event.
    const event: DecisionEvent = {
      at: nowIso,
      actor: opts?.actor ?? 'system',
      kind:
        to === 'blocked' ? 'blocked' : previousState === 'blocked' ? 'resumed' : 'status_changed',
      previousState,
      newState: to,
      reason: opts?.reason,
    };
    d.history = [...(d.history ?? []), event];
    await this.persist();
    return d;
  }

  summary(): DecisionSummaryView {
    this.load();
    // Scoped: a summary over every tenant's decisions is a disclosure of shape.
    return summarizeDecisions(this.tenancy.onlyMine(this.decisions));
  }
}
