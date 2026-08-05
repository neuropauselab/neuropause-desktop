/**
 * Finance → Fixed Assets — asset register domain types and the pure,
 * DETERMINISTIC straight-line depreciation rules the Fixed Assets module
 * enforces.
 *
 * A FixedAsset is a typed *projection* of the framework's flat
 * `EnterpriseEntity` (same blueprint as invoices/bills/GL). Depreciation is
 * arithmetic, never opinion: straight-line over the useful life in months,
 * cents-rounded per month with the FINAL month absorbing the rounding
 * remainder so accumulated depreciation lands EXACTLY on cost − salvage.
 * Capitalization, monthly depreciation, and disposal each derive journal
 * entries (idempotent by entry number) through the same auto-posting seam the
 * commercial modules use; disposal books the exact gain or loss. One method,
 * done right — declining-balance arrives as its own increment, not as a stub.
 * Pure (no I/O); the AI explains the schedule, never sets it.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import { GL_CONTROL_ACCOUNTS, type GlJournalLine } from './generalLedger';

/** The Fixed Assets module id + record kind (the framework store key). */
export const FIXED_ASSETS_MODULE_ID = 'finance-fixed-assets';
export const FIXED_ASSET_KIND = 'fixedAsset';

/** Asset-side control accounts (seeded only into an empty chart). */
export const GL_ASSET_CONTROL_ACCOUNTS = {
  fixedAssets: { code: '1500', name: 'Fixed Assets', accountClass: 'asset' as const },
  /** Contra-asset modelled as an asset-class account carrying credit balances. */
  accumulatedDepreciation: { code: '1590', name: 'Accumulated Depreciation', accountClass: 'asset' as const },
  depreciationExpense: { code: '5100', name: 'Depreciation Expense', accountClass: 'expense' as const },
  gainOnDisposal: { code: '4100', name: 'Gain on Asset Disposal', accountClass: 'revenue' as const },
  lossOnDisposal: { code: '5200', name: 'Loss on Asset Disposal', accountClass: 'expense' as const },
} as const;

export type FixedAssetStatus = 'draft' | 'capitalized' | 'disposed';

/** A typed view over a fixed-asset record's flat fields (+ envelope). */
export interface FixedAsset {
  id: string;
  assetNumber: string;
  assetName: string;
  category: string;
  acquisitionCost: number;
  acquisitionDate: string;
  usefulLifeMonths: number;
  salvageValue: number;
  accumulatedDepreciation: number;
  bookValue: number;
  depreciatedThroughPeriod: string;
  status: FixedAssetStatus;
  capitalizedAt: string;
  disposedAt: string;
  disposalProceeds: number;
  disposalDate: string;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Project a fixed-asset record into its typed view. */
export function fixedAssetFromRecord(record: EnterpriseEntity): FixedAsset {
  const f = record.fields;
  const cost = num(f.acquisitionCost);
  const accumulated = num(f.accumulatedDepreciation);
  const disposedAt = str(f.disposedAt);
  const capitalizedAt = str(f.capitalizedAt);
  return {
    id: record.id,
    assetNumber: str(f.assetNumber).trim(),
    assetName: str(f.assetName),
    category: str(f.category),
    acquisitionCost: cost,
    acquisitionDate: str(f.acquisitionDate),
    usefulLifeMonths: Math.max(0, Math.floor(num(f.usefulLifeMonths))),
    salvageValue: num(f.salvageValue),
    accumulatedDepreciation: accumulated,
    bookValue: round2(cost - accumulated),
    depreciatedThroughPeriod: str(f.depreciatedThroughPeriod),
    status: disposedAt ? 'disposed' : capitalizedAt ? 'capitalized' : 'draft',
    capitalizedAt,
    disposedAt,
    disposalProceeds: num(f.disposalProceeds),
    disposalDate: str(f.disposalDate),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The straight-line schedule: per-month amounts whose sum is EXACT. */
export function straightLineSchedule(input: {
  acquisitionCost: number;
  salvageValue: number;
  usefulLifeMonths: number;
}): number[] {
  const { usefulLifeMonths } = input;
  if (usefulLifeMonths <= 0) return [];
  const depreciable = round2(input.acquisitionCost - input.salvageValue);
  if (depreciable <= 0) return new Array<number>(usefulLifeMonths).fill(0);
  const monthly = round2(depreciable / usefulLifeMonths);
  const schedule = new Array<number>(usefulLifeMonths).fill(monthly);
  // The final month absorbs the rounding remainder — the total is exact.
  const allButLast = round2(monthly * (usefulLifeMonths - 1));
  schedule[usefulLifeMonths - 1] = round2(depreciable - allButLast);
  return schedule;
}

/** The next YYYY-MM after a YYYY-MM key ('' input → the acquisition month). */
export function nextPeriodKey(afterPeriod: string, acquisitionDate: string): string {
  if (!afterPeriod) {
    const m = /^(\d{4})-(\d{2})/.exec(acquisitionDate.trim());
    return m ? `${m[1]}-${m[2]}` : '';
  }
  const m = /^(\d{4})-(\d{2})$/.exec(afterPeriod.trim());
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}`;
}

export interface NextDepreciation {
  ok: boolean;
  /** The period the next posting covers (YYYY-MM). */
  periodKey: string;
  /** The month index in the schedule (0-based). */
  monthIndex: number;
  amount: number;
  reason: string;
}

/**
 * Decide the next monthly depreciation posting for a capitalized asset. Refuses
 * (with the reason stated) when the asset is not capitalized, is disposed, or
 * the schedule is complete — accumulated depreciation can never pass
 * cost − salvage, by construction.
 */
export function nextDepreciation(asset: FixedAsset): NextDepreciation {
  const none = (reason: string): NextDepreciation => ({ ok: false, periodKey: '', monthIndex: -1, amount: 0, reason });
  if (asset.status === 'draft') return none('Asset is not capitalized yet.');
  if (asset.status === 'disposed') return none('Asset is disposed — its schedule is closed.');
  const schedule = straightLineSchedule(asset);
  if (schedule.length === 0) return none('Useful life must be at least one month.');
  // Count of months already posted = index of the next one.
  const monthIndex = (() => {
    if (!asset.depreciatedThroughPeriod) return 0;
    // Derive count from accumulated amount matching the schedule prefix.
    let sum = 0;
    for (let i = 0; i < schedule.length; i++) {
      sum = round2(sum + schedule[i]);
      if (Math.round((sum - asset.accumulatedDepreciation) * 100) === 0) return i + 1;
    }
    return schedule.length;
  })();
  if (monthIndex >= schedule.length) return none('Schedule complete — book value is at salvage.');
  const periodKey = nextPeriodKey(asset.depreciatedThroughPeriod, asset.acquisitionDate);
  if (!periodKey) return none('Acquisition date must be set to derive the schedule start.');
  return { ok: true, periodKey, monthIndex, amount: schedule[monthIndex], reason: '' };
}

/* ── derived journal lines (posted through the shared auto-posting seam) ── */

export function faCapEntryNumber(assetNumber: string): string {
  return `JE-FA-${assetNumber}-CAP`;
}
export function faDepEntryNumber(assetNumber: string, periodKey: string): string {
  return `JE-FA-${assetNumber}-DEP-${periodKey}`;
}
export function faDisposalEntryNumber(assetNumber: string): string {
  return `JE-FA-${assetNumber}-DISP`;
}

/** Capitalization: Dr Fixed Assets / Cr Cash (vendor-bill acquisition later). */
export function faCapitalizationLines(cost: number): GlJournalLine[] {
  return [
    { account: GL_ASSET_CONTROL_ACCOUNTS.fixedAssets.code, debit: cost, credit: 0 },
    { account: GL_CONTROL_ACCOUNTS.cash.code, debit: 0, credit: cost },
  ];
}

/** One month: Dr Depreciation Expense / Cr Accumulated Depreciation. */
export function faDepreciationLines(amount: number): GlJournalLine[] {
  return [
    { account: GL_ASSET_CONTROL_ACCOUNTS.depreciationExpense.code, debit: amount, credit: 0 },
    { account: GL_ASSET_CONTROL_ACCOUNTS.accumulatedDepreciation.code, debit: 0, credit: amount },
  ];
}

/**
 * Disposal: remove cost and accumulated depreciation, take the proceeds, and
 * book the EXACT balancing gain or loss. Balanced by construction.
 */
export function faDisposalLines(input: {
  acquisitionCost: number;
  accumulatedDepreciation: number;
  proceeds: number;
}): GlJournalLine[] {
  const lines: GlJournalLine[] = [
    { account: GL_ASSET_CONTROL_ACCOUNTS.fixedAssets.code, debit: 0, credit: input.acquisitionCost },
  ];
  if (input.accumulatedDepreciation > 0) {
    lines.push({
      account: GL_ASSET_CONTROL_ACCOUNTS.accumulatedDepreciation.code,
      debit: input.accumulatedDepreciation,
      credit: 0,
    });
  }
  if (input.proceeds > 0) {
    lines.push({ account: GL_CONTROL_ACCOUNTS.cash.code, debit: input.proceeds, credit: 0 });
  }
  const bookValue = round2(input.acquisitionCost - input.accumulatedDepreciation);
  const result = round2(input.proceeds - bookValue);
  if (result > 0) {
    lines.push({ account: GL_ASSET_CONTROL_ACCOUNTS.gainOnDisposal.code, debit: 0, credit: result });
  } else if (result < 0) {
    lines.push({ account: GL_ASSET_CONTROL_ACCOUNTS.lossOnDisposal.code, debit: -result, credit: 0 });
  }
  return lines;
}
