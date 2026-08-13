/**
 * Procurement → Vendor Contracts — the pure contract-window engine (Final
 * Wave FW-7).
 *
 * A vendor contract is a dated commercial agreement with one supplier:
 * a validity window (start/end), a value, payment terms, and a renewal
 * notice period. The record lifecycle is human-driven (draft → active →
 * terminated); whether the window is OPEN on a given day is time-derived and
 * never stored — the engine computes it fresh every time it is asked.
 *
 * The cross-module teeth (mirrors FW-5's budget gate): a purchase order may
 * name a contract (`contractRef`); APPROVAL then requires that contract to be
 * live, human-activated, inside its window on the approval date, and for the
 * same supplier. A dangling, draft, terminated, expired, or wrong-supplier
 * contract REFUSES with the reason — a broken control never silently opens.
 * A PO with no contractRef is uncontrolled and behaves exactly as before.
 *
 * Pure (no I/O) so the module hooks and tests share it.
 */
import { parseLeaveDate } from './leave';

export const VENDOR_CONTRACTS_MODULE_ID = 'procurement-vendor-contracts';
export const VENDOR_CONTRACT_KIND = 'vendor-contract';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The generic-record shape the engine reads (vendor contracts). */
interface RecordLike {
  id: string;
  status: string;
  fields: Record<string, unknown>;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Strict YYYY-MM-DD → UTC ms (rollover-rejecting); null when invalid. */
export const parseContractDate = parseLeaveDate;

/** Reduce an ISO timestamp or date to its UTC day in ms; null when unusable. */
export function contractDayOf(iso: string): number | null {
  const dateOnly = parseContractDate(iso.slice(0, 10));
  if (dateOnly !== null) return dateOnly;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor(t / DAY_MS) * DAY_MS;
}

/** Where a contract's validity window stands on a given day. */
export type ContractWindowState = 'invalid' | 'pending' | 'open' | 'expired';

/**
 * Compute the window state on `onIso` (an ISO date or timestamp). Both bounds
 * are INCLUSIVE calendar days: a contract is open from 00:00 UTC of its start
 * date through the whole of its end date.
 */
export function contractWindowState(startDate: string, endDate: string, onIso: string): ContractWindowState {
  const start = parseContractDate(startDate);
  const end = parseContractDate(endDate);
  const on = contractDayOf(onIso);
  if (start === null || end === null || on === null || end < start) return 'invalid';
  if (on < start) return 'pending';
  if (on > end) return 'expired';
  return 'open';
}

/** Whole days from `onIso` to the end date (0 = expires today); null when unusable. */
export function contractDaysRemaining(endDate: string, onIso: string): number | null {
  const end = parseContractDate(endDate);
  const on = contractDayOf(onIso);
  if (end === null || on === null) return null;
  return Math.round((end - on) / DAY_MS);
}

/** One PO-approval contract decision, with the reason spelled out. */
export interface ContractGateDecision {
  /** Whether approval may proceed. */
  allowed: boolean;
  /** True when the PO named a contract at all. */
  controlled: boolean;
  /** True when the named contract resolved to a live record. */
  contractFound: boolean;
  contractNumber: string;
  /** Window state on the approval date ('invalid' when not found). */
  state: ContractWindowState;
  /** Days to expiry when the window is open; null otherwise. */
  daysRemaining: number | null;
  /** True when open but inside the renewal notice period. */
  expiringSoon: boolean;
  /** The sentence the module stamps/says. */
  note: string;
}

/**
 * Evaluate one PO's approval against its named vendor contract on `onDate`.
 * Supplier matching is by name, case-insensitively — purchase orders carry
 * the supplier as text; the contract snapshots its supplier's name.
 */
export function evaluateContractGate(input: {
  contractRef: string;
  supplierName: string;
  onDate: string;
  contracts: ReadonlyArray<RecordLike>;
}): ContractGateDecision {
  const ref = str(input.contractRef).trim();
  const base: ContractGateDecision = {
    allowed: true,
    controlled: ref !== '',
    contractFound: false,
    contractNumber: '',
    state: 'invalid',
    daysRemaining: null,
    expiringSoon: false,
    note: '',
  };
  if (!ref) {
    base.note = 'No contract named — this order is not contract-controlled.';
    return base;
  }
  const contract = input.contracts.find((r) => r.id === ref && r.status !== 'deleted');
  if (!contract) {
    return {
      ...base,
      allowed: false,
      note: `Vendor contract "${ref}" was not found — a dangling contract control never approves silently. Fix the reference or clear it.`,
    };
  }
  const f = contract.fields;
  const contractNumber = str(f.contractNumber) || ref;
  const recordStatus = str(f.status);
  if (recordStatus !== 'active') {
    return {
      ...base,
      allowed: false,
      contractFound: true,
      contractNumber,
      note:
        recordStatus === 'terminated'
          ? `Vendor contract ${contractNumber} is terminated — approve against a live contract or clear the reference.`
          : `Vendor contract ${contractNumber} is still a draft — activate it before orders can rely on it.`,
    };
  }
  const state = contractWindowState(str(f.startDate), str(f.endDate), input.onDate);
  if (state !== 'open') {
    const why =
      state === 'pending'
        ? `has not started (window opens ${str(f.startDate)})`
        : state === 'expired'
          ? `expired on ${str(f.endDate)}`
          : 'has an invalid validity window';
    return {
      ...base,
      allowed: false,
      contractFound: true,
      contractNumber,
      state,
      note: `Vendor contract ${contractNumber} ${why} — approval refuses on a closed window.`,
    };
  }
  const poSupplier = str(input.supplierName).trim().toLowerCase();
  const contractSupplier = str(f.supplierName).trim().toLowerCase();
  if (poSupplier && contractSupplier && poSupplier !== contractSupplier) {
    return {
      ...base,
      allowed: false,
      contractFound: true,
      contractNumber,
      state,
      note: `Vendor contract ${contractNumber} is with "${str(f.supplierName)}", not "${str(input.supplierName)}" — a contract governs its own supplier's orders only.`,
    };
  }
  const daysRemaining = contractDaysRemaining(str(f.endDate), input.onDate);
  const noticeDays = Math.max(num(f.renewalNoticeDays), 0);
  const expiringSoon = daysRemaining !== null && daysRemaining <= noticeDays;
  return {
    ...base,
    contractFound: true,
    contractNumber,
    state,
    daysRemaining,
    expiringSoon,
    note:
      `Covered by vendor contract ${contractNumber} (valid ${str(f.startDate)} → ${str(f.endDate)}` +
      (daysRemaining !== null ? `, ${daysRemaining} day(s) remaining` : '') +
      ').' +
      (expiringSoon ? ` RENEWAL DUE — inside the ${noticeDays}-day notice period.` : ''),
  };
}
