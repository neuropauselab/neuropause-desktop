/**
 * Finance → Exchange Rates — effective-dated FX rate table + the pure
 * conversion engine (W6-B1), the foundation of the multi-currency workstream.
 *
 * A rate record is a dated fact: 1 unit of `fromCurrency` = `rate` units of
 * `toCurrency`, effective on/after `effectiveFrom`. Conversion resolves the
 * rate governing a date (latest `effectiveFrom` on or before it), the same
 * effective-dated pattern as the statutory rule tables. Missing rates return
 * NULL — the caller must refuse, never silently assume 1:1 (that would post
 * wrong money). Same-currency is 1; a reverse-pair is inverted when no direct
 * rate exists. Triangulation through a base currency is a stated future
 * refinement, not faked here.
 *
 * This increment is FOUNDATION ONLY: the register stores rates and the engine
 * converts. Applying FX to documents, revaluation, and realized/unrealized
 * gain-loss are later B-increments that build on this tested base — the
 * certified General Ledger is untouched here.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity } from './enterpriseModule';

/** The Exchange Rates module id + record kind (the framework store key). */
export const EXCHANGE_RATES_MODULE_ID = 'finance-exchange-rates';
export const EXCHANGE_RATE_KIND = 'exchangeRate';

/** ISO 4217 currency codes are three uppercase letters. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const round2 = (n: number): number => Math.round(n * 100) / 100;
/** Rates carry more precision than money — six places is ample for FX. */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}

/** A typed view over an exchange-rate record's flat fields. */
export interface ExchangeRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  effectiveFrom: string;
  source: string;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Project a framework record into a typed exchange rate. */
export function exchangeRateFromRecord(record: EnterpriseEntity): ExchangeRate {
  const f = record.fields;
  return {
    id: record.id,
    fromCurrency: str(f.fromCurrency).toUpperCase(),
    toCurrency: str(f.toCurrency).toUpperCase(),
    rate: num(f.rate),
    effectiveFrom: str(f.effectiveFrom),
    source: str(f.source),
    lockedAt: str(f.lockedAt) || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The deterministic pair label, e.g. USD→INR. */
export function currencyPairCode(from: string, to: string): string {
  return `${str(from).toUpperCase()}-${str(to).toUpperCase()}`;
}

/**
 * Resolve the rate to convert `from` → `to` as of a date. Returns null when no
 * rate governs the date (the caller must refuse, not assume 1:1). Same
 * currency is 1; a reverse pair is inverted when no direct rate exists.
 */
export function resolveExchangeRate(
  rates: ExchangeRate[],
  from: string,
  to: string,
  asOfDate: string,
): number | null {
  const a = str(from).toUpperCase();
  const b = str(to).toUpperCase();
  if (!CURRENCY_PATTERN.test(a) || !CURRENCY_PATTERN.test(b)) return null;
  if (a === b) return 1;
  const on = str(asOfDate);
  const governing = (fromC: string, toC: string): ExchangeRate | null => {
    const candidates = rates
      .filter((r) => r.fromCurrency === fromC && r.toCurrency === toC && r.rate > 0 && r.effectiveFrom && r.effectiveFrom <= on)
      .sort((x, y) => y.effectiveFrom.localeCompare(x.effectiveFrom) || y.id.localeCompare(x.id));
    return candidates[0] ?? null;
  };
  const direct = governing(a, b);
  if (direct) return round6(direct.rate);
  const inverse = governing(b, a);
  if (inverse && inverse.rate > 0) return round6(1 / inverse.rate);
  return null;
}

export interface ConversionResult {
  /** null when no rate governs the date — the amount is NOT converted. */
  amount: number | null;
  rate: number | null;
  from: string;
  to: string;
}

/** Convert money `from` → `to` as of a date; amount is null when unresolved. */
export function convertAmount(
  rates: ExchangeRate[],
  amount: number,
  from: string,
  to: string,
  asOfDate: string,
): ConversionResult {
  const a = str(from).toUpperCase();
  const b = str(to).toUpperCase();
  const rate = resolveExchangeRate(rates, a, b, asOfDate);
  return {
    amount: rate === null ? null : round2(num(amount) * rate),
    rate,
    from: a,
    to: b,
  };
}
