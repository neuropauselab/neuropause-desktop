/**
 * P2.4 — Microsoft 365 write-action SDK.
 *
 * A WriteAction is a single audited, confirmation-gated Microsoft Graph mutation (send mail, create event,
 * upload file, post a Teams message, CRUD a contact). Actions receive an authenticated, rate-gated
 * HttpClient — the SAME Graph session as sync, no new OAuth — and return a structured result. The executor
 * (executor.ts) wraps every run with scope validation, the confirmation gate, and the timeline/audit/health
 * fan-out; an action itself contains ONLY the live Graph request + response mapping. No mocks.
 */
import type { HttpClient } from '../../unified/sync/http';

export const GRAPH = 'https://graph.microsoft.com/v1.0';

export type WriteDomain = 'mail' | 'calendar' | 'drive' | 'teams' | 'contacts';

export interface WriteActionContext {
  connectorId: string;
  accountId: string;
  http: HttpClient;
  now: string;
}

export interface WriteActionResult {
  ok: boolean;
  /** Short, non-sensitive human summary for the activity feed + timeline. */
  summary: string;
  /** Non-sensitive payload (ids, links, counts). */
  data?: Record<string, string | number | boolean | null>;
  /** Graph rate-limit remaining, if the response exposed it. */
  quotaRemaining?: number | null;
}

export type WriteParams = Record<string, unknown>;

export interface WriteAction {
  id: string;
  label: string;
  domain: WriteDomain;
  scopes: string[];
  /** true = mutates data → requires explicit confirmation. false = read helper (search / download / list). */
  mutates: boolean;
  run(ctx: WriteActionContext, params: WriteParams): Promise<WriteActionResult>;
}

/* ── param helpers — throw a clear, non-sensitive error on bad input (also validated at the IPC edge) ── */

export class ActionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionInputError';
  }
}

export function str(p: WriteParams, k: string): string {
  const v = p[k];
  if (typeof v !== 'string' || v.trim() === '') throw new ActionInputError(`Missing required field "${k}"`);
  return v;
}
export function optStr(p: WriteParams, k: string): string | undefined {
  const v = p[k];
  return typeof v === 'string' && v !== '' ? v : undefined;
}
export function strArr(p: WriteParams, k: string): string[] {
  const v = p[k];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new ActionInputError(`Field "${k}" must be an array of strings`);
  }
  return v as string[];
}
export function optStrArr(p: WriteParams, k: string): string[] {
  return p[k] === undefined ? [] : strArr(p, k);
}
export function optBool(p: WriteParams, k: string, dflt = false): boolean {
  const v = p[k];
  return typeof v === 'boolean' ? v : dflt;
}
export function optObj(p: WriteParams, k: string): Record<string, unknown> | undefined {
  const v = p[k];
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** Build a Graph recipient list from email addresses. */
export function recipients(addresses: string[]): Array<{ emailAddress: { address: string } }> {
  return addresses.map((address) => ({ emailAddress: { address } }));
}

/** Read the rate-limit-remaining header from a Graph response, if present (else null). */
export function quotaFrom(headers: Record<string, string>): number | null {
  const v = headers['x-ratelimit-remaining'];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Percent-encode a single Graph path/query segment. */
export function enc(s: string): string {
  return encodeURIComponent(s);
}
