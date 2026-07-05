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
import { dirname } from 'node:path';
import type {
  DecisionCategory,
  DecisionStatus,
  DecisionSummaryView,
  ExecutiveDecision,
  ExecutiveRecommendation,
} from '@neuropause/shared';

interface DecisionFile {
  decisions: ExecutiveDecision[];
}

const MAX_DECISIONS = 500;

/** Valid lifecycle transitions (STEP 3). */
const TRANSITIONS: Record<DecisionStatus, DecisionStatus[]> = {
  draft: ['suggested', 'accepted', 'rejected', 'archived'],
  suggested: ['accepted', 'rejected', 'archived'],
  accepted: ['in_progress', 'completed', 'rejected', 'archived'],
  in_progress: ['completed', 'rejected', 'archived'],
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
  };
}

const IMPACT_RANK: Record<ExecutiveDecision['priority'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Build the compact section view (STEP 6). Pure over a decision list. */
export function summarizeDecisions(decisions: ExecutiveDecision[]): DecisionSummaryView {
  const active = decisions.filter((d) => d.status !== 'archived');
  const pending = active.filter((d) => d.status === 'suggested' || d.status === 'draft').length;
  const accepted = active.filter(
    (d) => d.status === 'accepted' || d.status === 'in_progress',
  ).length;
  const completed = active.filter((d) => d.status === 'completed').length;
  const rejected = active.filter((d) => d.status === 'rejected').length;
  const top = [...active]
    .sort((a, b) => {
      const p = IMPACT_RANK[b.priority] - IMPACT_RANK[a.priority];
      if (p !== 0) return p;
      return b.createdAt < a.createdAt ? -1 : 1; // newer first
    })
    .slice(0, 6);
  return { total: active.length, pending, accepted, completed, rejected, top };
}

export class DecisionStore {
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

  /** All decisions, newest first. */
  all(): ExecutiveDecision[] {
    this.load();
    return [...this.decisions].sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
  }

  get(id: string): ExecutiveDecision | null {
    this.load();
    return this.decisions.find((d) => d.id === id) ?? null;
  }

  /** Persist a new decision (deduped by id; last write wins). */
  async create(decision: ExecutiveDecision): Promise<ExecutiveDecision> {
    this.load();
    const idx = this.decisions.findIndex((d) => d.id === decision.id);
    if (idx >= 0) this.decisions[idx] = decision;
    else this.decisions.push(decision);
    if (this.decisions.length > MAX_DECISIONS) {
      // Drop oldest archived first, else oldest overall.
      this.decisions.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      this.decisions = this.decisions.slice(-MAX_DECISIONS);
    }
    await this.persist();
    return decision;
  }

  /**
   * Transition a decision's status if the transition is legal. Returns the updated
   * decision, or null if not found / illegal transition.
   */
  async setStatus(
    id: string,
    to: DecisionStatus,
    nowIso: string,
  ): Promise<ExecutiveDecision | null> {
    this.load();
    const d = this.decisions.find((x) => x.id === id);
    if (!d) return null;
    if (d.status === to) return d;
    if (!canTransition(d.status, to)) return null;
    d.status = to;
    d.updatedAt = nowIso;
    await this.persist();
    return d;
  }

  summary(): DecisionSummaryView {
    this.load();
    return summarizeDecisions(this.decisions);
  }
}
