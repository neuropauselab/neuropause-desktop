/**
 * AI Operating Platform — shared presentation contract (Phase 3).
 *
 * This workspace is the enterprise "AI operating layer": a single surface that
 * COMPOSES the platform's already-shipped AI capabilities (planning, reasoning,
 * orchestration, memory, decisions, simulation, learning, governance, executive
 * intelligence) into one operating loop:
 *
 *     plan -> reason -> orchestrate -> simulate -> decide -> govern -> learn -> execute
 *
 * It adds NO new runtime, IPC channel, engine, store, or service. Every tab model
 * is a PURE derivation over data returned by EXISTING `ipc.*` methods. Every
 * capability the platform does not genuinely have is surfaced as an honest, labeled
 * `OpGap` ("Requires ...") rather than a fabricated value — this is the core of the
 * production-authenticity contract. When a real signal is simply empty (e.g. no jobs
 * have run yet), the honest empty state shows through instead of a placeholder.
 */
import type { IconName } from '@renderer/components/ui/Icon';
import type { SectionId } from '@renderer/shell/sections';
import type { OpsTone } from '@renderer/operations/lib';

export type { OpsTone };

/** A single headline metric — always backed by a real source value. */
export interface OpStat {
  icon: IconName;
  label: string;
  value: string;
  tone?: OpsTone;
  hint?: string;
}

/** A real, source-derived detail line inside a titled group. */
export interface OpRow {
  label: string;
  value: string;
  tone?: OpsTone;
  sub?: string;
}

/** A titled group of real rows within a tab. */
export interface OpGroup {
  title: string;
  rows: OpRow[];
  note?: string;
}

/**
 * An honestly-labeled capability gap. The platform has no real backing for this,
 * so the workspace states the real architecture it would require instead of
 * inventing a number. Never used to hide a value that IS available.
 */
export interface OpGap {
  capability: string;
  requires: string;
  note?: string;
}

/** A deep-link to the canonical existing surface for a capability (reuse, not duplicate). */
export interface OpLink {
  label: string;
  section: SectionId;
  icon?: IconName;
}

/** The view-ready state a tab derivation produces; rendered uniformly by the view. */
export interface OpLens {
  stats: OpStat[];
  groups: OpGroup[];
  gaps: OpGap[];
  links?: OpLink[];
}

export const EMPTY_LENS: OpLens = { stats: [], groups: [], gaps: [], links: [] };

/** Tone for a 0..1 ratio where HIGHER is better (health, success rate, coverage). */
export function healthTone(ratio: number): OpsTone {
  if (!Number.isFinite(ratio)) return 'gray';
  if (ratio >= 0.8) return 'green';
  if (ratio >= 0.5) return 'orange';
  return 'red';
}

/** Tone for a 0..1 ratio where HIGHER is worse (risk, failure rate, load). */
export function riskTone(ratio: number): OpsTone {
  if (!Number.isFinite(ratio)) return 'gray';
  if (ratio >= 0.66) return 'red';
  if (ratio >= 0.33) return 'orange';
  return 'green';
}

/** Safe integer formatting for counts (never renders NaN/undefined). */
export function count(n: number | undefined | null): string {
  return Number.isFinite(n) ? String(Math.trunc(n as number)) : '0';
}

/** Safe 0..1 -> "NN%" (never renders NaN). */
export function pctText(ratio: number | undefined | null): string {
  return Number.isFinite(ratio) ? `${Math.round((ratio as number) * 100)}%` : '—';
}
