/**
 * Sales → Contracts — commercial-agreement domain types + pure deterministic
 * logic.
 *
 * A Contract is a typed *projection* of the framework's flat
 * `EnterpriseEntity` — the Enterprise Module Framework owns persistence, CRUD,
 * RBAC, audit, timeline, and UI. This file adds the contract-specific typing
 * and the DETERMINISTIC rules: the marker-derived stored status
 * (draft → active → terminated), the TIME-DERIVED runtime state (expiring /
 * expired are computed at read time against the end date — never stored, so
 * they can never go stale), calendar-exact renewal date math with month-end
 * clamping, and the expiry health clock.
 *
 * Contract value is COMMERCIAL, not booked revenue: contracts never post to
 * the General Ledger. Revenue still enters the books only through the W1
 * Quote → Order → Invoice → Payment chain; revenue recognition against
 * contracts is a Finance concern deliberately out of W2's scope.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';

/** The Contracts module id + record kind (the framework store key). */
export const CONTRACTS_MODULE_ID = 'sales-contracts';
export const CONTRACT_KIND = 'contract';

/** Marker-derived STORED status — never user-set, always from the markers. */
export type ContractStatus = 'draft' | 'active' | 'terminated';

/** Time-derived READ state — expiring/expired computed against `nowMs`. */
export type ContractRuntimeState = 'draft' | 'active' | 'expiring' | 'expired' | 'terminated';

/** Active contracts within this many days of their end date are `expiring`. */
export const CONTRACT_EXPIRY_WINDOW_DAYS = 30;

/** A typed view over a contract record's flat fields (+ envelope timestamps). */
export interface SalesContract {
  id: string;
  contractNumber: string;
  title: string;
  customerRef: string;
  opportunityRef: string;
  contractValue: number;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  autoRenew: boolean;
  renewalTermMonths: number;
  status: ContractStatus;
  activatedAt: string | null;
  terminatedAt: string | null;
  terminationReason: string;
  renewedFromRef: string;
  renewedToRef: string;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}

/** The stored status, derived strictly from the lifecycle markers. */
export function deriveContractStatus(fields: {
  activatedAt?: unknown;
  terminatedAt?: unknown;
}): ContractStatus {
  if (str(fields.terminatedAt)) return 'terminated';
  if (str(fields.activatedAt)) return 'active';
  return 'draft';
}

/** Project a framework record into a typed contract. */
export function contractFromRecord(record: EnterpriseEntity): SalesContract {
  const f = record.fields;
  return {
    id: record.id,
    contractNumber: str(f.contractNumber) || record.title,
    title: str(f.title),
    customerRef: str(f.customerRef),
    opportunityRef: str(f.opportunityRef),
    contractValue: num(f.contractValue),
    currency: str(f.currency) || 'USD',
    startDate: str(f.startDate) || null,
    endDate: str(f.endDate) || null,
    autoRenew: str(f.autoRenew) === 'yes',
    renewalTermMonths: num(f.renewalTermMonths),
    status: deriveContractStatus(f),
    activatedAt: str(f.activatedAt) || null,
    terminatedAt: str(f.terminatedAt) || null,
    terminationReason: str(f.terminationReason),
    renewedFromRef: str(f.renewedFromRef),
    renewedToRef: str(f.renewedToRef),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The dates rule: a contract must END strictly AFTER it starts. */
export function contractDatesError(startDate: string, endDate: string): string | null {
  const s = Date.parse(startDate);
  const e = Date.parse(endDate);
  if (!Number.isFinite(s)) return 'Start date is not a valid date.';
  if (!Number.isFinite(e)) return 'End date is not a valid date.';
  if (e <= s) return 'End date must be after the start date.';
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Calendar-exact month addition with month-end clamping (Jan 31 + 1 month →
 * Feb 28, or Feb 29 in a leap year). Input/output `YYYY-MM-DD`. Deterministic.
 */
export function addMonthsClamped(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map((part) => Number(part));
  const targetMonthIndex = m - 1 + months; // 0-based month arithmetic
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

/** The successor term a renewal drafts: starts when the old term ends. */
export function contractRenewalDates(contract: SalesContract): { startDate: string; endDate: string } | null {
  if (!contract.endDate) return null;
  const months = contract.renewalTermMonths > 0 ? contract.renewalTermMonths : 12;
  return { startDate: contract.endDate, endDate: addMonthsClamped(contract.endDate, months) };
}

/** The time-derived runtime state — stored status + the end-date clock. */
export function contractRuntimeState(contract: SalesContract, nowMs: number): ContractRuntimeState {
  if (contract.status === 'terminated') return 'terminated';
  if (contract.status === 'draft') return 'draft';
  const endMs = contract.endDate ? Date.parse(contract.endDate) : NaN;
  if (Number.isFinite(endMs)) {
    if (endMs < nowMs) return 'expired';
    if (endMs - nowMs <= CONTRACT_EXPIRY_WINDOW_DAYS * DAY_MS) return 'expiring';
  }
  return 'active';
}

export interface ContractHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

/** Deterministic contract health from the runtime state. */
export function assessContractHealth(contract: SalesContract, nowMs: number): ContractHealth {
  const state = contractRuntimeState(contract, nowMs);
  const endMs = contract.endDate ? Date.parse(contract.endDate) : NaN;
  switch (state) {
    case 'terminated':
      return { level: 'low', reason: 'Terminated.' };
    case 'draft':
      return { level: 'medium', reason: 'Draft — not yet active.' };
    case 'expired': {
      const daysOver = Number.isFinite(endMs) ? Math.max(1, Math.round((nowMs - endMs) / DAY_MS)) : 0;
      return { level: 'high', reason: `Expired ${daysOver} day${daysOver === 1 ? '' : 's'} ago — renew or terminate.` };
    }
    case 'expiring': {
      const daysLeft = Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - nowMs) / DAY_MS)) : 0;
      return { level: 'medium', reason: `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.` };
    }
    default: {
      const daysLeft = Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - nowMs) / DAY_MS)) : 0;
      return { level: 'low', reason: `Active — ${daysLeft} days remaining.` };
    }
  }
}

function formatMoney(value: number): string {
  // Locale pinned: unpinned formatting is machine-dependent (en-IN lakh grouping
  // renders 120000 as "1,20,000"), which breaks deterministic summaries + tests.
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Deterministic summary — the no-model fallback. */
export function contractSummaryFallback(
  contract: SalesContract,
  health: ContractHealth,
  nowMs: number,
): { summary: string; executiveExplanation: string } {
  const state = contractRuntimeState(contract, nowMs);
  const term = contract.startDate && contract.endDate ? ` (${contract.startDate} → ${contract.endDate})` : '';
  const renewal = contract.renewedToRef
    ? ' A renewal has been drafted.'
    : contract.autoRenew
      ? ' Auto-renew is on.'
      : '';
  const summary =
    `${contract.contractNumber} is a ${state} contract worth ${formatMoney(contract.contractValue)}${term}. ` +
    `${health.reason}${renewal}`;
  const executiveExplanation =
    state === 'expired'
      ? `${formatMoney(contract.contractValue)} of contracted business is past its end date — decide renewal now.`
      : state === 'expiring'
        ? `${formatMoney(contract.contractValue)} of contracted business ends soon — renewal window is open.`
        : state === 'active'
          ? `${formatMoney(contract.contractValue)} contracted through ${contract.endDate ?? '—'}.`
          : state === 'draft'
            ? 'Not yet in force — activate to start the term.'
            : 'Terminated — no live obligation.';
  return { summary, executiveExplanation };
}
