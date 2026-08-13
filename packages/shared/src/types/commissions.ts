/**
 * Sales → Commissions — commission-plan configuration + the pure statement
 * engine (W2.5).
 *
 * Two record kinds share this domain: PLANS are configuration (the Pricing
 * Rules pattern — freely editable, no markers): who earns what percentage,
 * rep-specific or for everyone. STATEMENTS are immutable point-in-time
 * snapshots (the Aging pattern): creating one derives, per sales rep, the
 * closed-won opportunity value inside an accounting period and the commission
 * the best matching plan grants on it.
 *
 * BASIS, stated honestly: commissions here are BOOKINGS-based — computed on
 * opportunities marked won inside the period (`closedAt`), attributed to the
 * opportunity's `assignedTo`. Cash-based commission (on collected invoices)
 * is a Finance concern the invoice documents don't yet attribute to reps —
 * not faked here. Reps with won business but NO matching plan appear with a
 * zero rate — visible, never silently dropped. Statements never post to the
 * General Ledger.
 *
 * Plan precedence is deterministic: a rep-scoped plan beats an all-reps plan;
 * among equals the lowest `priority` number wins, then plan name. Period
 * bounds reuse the W1 General Ledger period math — never re-implemented.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import type { CrmOpportunity } from './opportunities';
import { glPeriodBounds } from './generalLedger';

/** The Commission Plans module id + record kind (the framework store key). */
export const COMMISSION_PLANS_MODULE_ID = 'sales-commission-plans';
export const COMMISSION_PLAN_KIND = 'commissionPlan';

/** The Commission Statements module id + record kind (the framework store key). */
export const COMMISSION_STATEMENTS_MODULE_ID = 'sales-commission-statements';
export const COMMISSION_STATEMENT_KIND = 'commissionStatement';

/** A typed view over a commission-plan record's flat fields. */
export interface CommissionPlan {
  id: string;
  planName: string;
  scope: 'all' | 'rep';
  /** Exact rep name (matches the opportunity's `assignedTo`; scope 'rep' only). */
  repName: string;
  /** Commission percentage of won value, (0..100]. */
  ratePct: number;
  active: boolean;
  /** Tie-breaker — lower number wins. */
  priority: number;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Project a framework record into a typed commission plan. */
export function commissionPlanFromRecord(record: EnterpriseEntity): CommissionPlan {
  const f = record.fields;
  return {
    id: record.id,
    planName: str(f.planName) || record.title,
    scope: str(f.scope) === 'rep' ? 'rep' : 'all',
    repName: str(f.repName),
    ratePct: num(f.ratePct),
    active: str(f.active) !== 'no',
    priority: num(f.priority) || 100,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * The plan that pays a rep: rep-scoped beats all-scoped; then lowest priority
 * number; then plan name. `null` when no active plan matches. Pure.
 */
export function commissionPlanFor(rep: string, plans: CommissionPlan[]): CommissionPlan | null {
  let winner: CommissionPlan | null = null;
  for (const plan of plans) {
    if (!plan.active || plan.ratePct <= 0) continue;
    if (plan.scope === 'rep' && plan.repName !== rep) continue;
    const beats =
      !winner ||
      (plan.scope === 'rep' && winner.scope === 'all') ||
      (plan.scope === winner.scope &&
        (plan.priority < winner.priority ||
          (plan.priority === winner.priority && plan.planName < winner.planName)));
    if (beats) winner = plan;
  }
  return winner;
}

/** One rep's line on a commission statement. */
export interface CommissionRow {
  rep: string;
  wonCount: number;
  wonValue: number;
  ratePct: number;
  planName: string | null;
  commission: number;
}

export interface CommissionStatementResult {
  rows: CommissionRow[];
  repCount: number;
  totalWonValue: number;
  totalCommission: number;
}

/**
 * The statement engine: per-rep closed-won value inside the period × the best
 * matching plan's rate. Reps without a plan appear at rate 0 — never dropped.
 */
export function deriveCommissionStatement(
  opportunities: CrmOpportunity[],
  plans: CommissionPlan[],
  periodKey: string,
  repFilter: string,
): CommissionStatementResult {
  const bounds = glPeriodBounds(periodKey); // inclusive first/last day of the month
  const startMs = Date.parse(`${bounds.startDate}T00:00:00.000Z`);
  const endMsExclusive = Date.parse(`${bounds.endDate}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
  const byRep = new Map<string, { wonCount: number; wonValue: number }>();
  for (const opp of opportunities) {
    if (opp.outcome !== 'won' || !opp.closedAt) continue;
    const closedMs = Date.parse(opp.closedAt);
    if (!Number.isFinite(closedMs) || closedMs < startMs || closedMs >= endMsExclusive) continue;
    const rep = opp.assignedTo || 'Unassigned';
    if (repFilter && rep !== repFilter) continue;
    const cell = byRep.get(rep) ?? { wonCount: 0, wonValue: 0 };
    cell.wonCount += 1;
    cell.wonValue = round2(cell.wonValue + opp.amount);
    byRep.set(rep, cell);
  }
  const rows: CommissionRow[] = [...byRep.entries()]
    .map(([rep, cell]) => {
      const plan = commissionPlanFor(rep, plans);
      const ratePct = plan ? plan.ratePct : 0;
      return {
        rep,
        wonCount: cell.wonCount,
        wonValue: cell.wonValue,
        ratePct,
        planName: plan ? plan.planName : null,
        commission: round2((cell.wonValue * ratePct) / 100),
      };
    })
    .sort((a, b) => b.commission - a.commission || a.rep.localeCompare(b.rep));
  return {
    rows,
    repCount: rows.length,
    totalWonValue: round2(rows.reduce((s, r) => s + r.wonValue, 0)),
    totalCommission: round2(rows.reduce((s, r) => s + r.commission, 0)),
  };
}
