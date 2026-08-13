/**
 * AI Ecosystem — pure presentation lens for the Platform Ecosystem workspace (Phase 5).
 *
 * This tab tells the AGENT PACKAGING / SHARING story by COMPOSING what the platform
 * has already shipped. It adds NO new runtime, IPC channel, engine, or store — every
 * stat/row below is derived from a REAL field returned by an EXISTING `ipc.*` read:
 *
 *   - ipc.workforce.workers()      -> WorkerSummary[]         the agent roster
 *                                                             (builtIn flag, lifecycle,
 *                                                              healthState, earned trustScore)
 *   - ipc.workforce.intelligence() -> WorkforceIntelligence   optional success-rate headline
 *
 * The "Agent supply chain (real, reused)" group is NOT derived from input: it describes
 * the genuinely-shipped P8.5 Installable Workers machinery (Ed25519-signed packaging,
 * semver versioning + rollback, the 8-layer install validator, governed least-privilege
 * composition). That machinery exists in the codebase regardless of how many agents are
 * loaded, so the group is always present — it fabricates no numbers (its value column is
 * qualitative), it merely references real capabilities.
 *
 * What today's ecosystem genuinely CANNOT do — export a reinstallable package, offer a
 * downloadable package catalog, or transfer a real agent artifact — is surfaced as an
 * honest `OpGap` ("Requires …"), never as an invented value. Those gaps are architectural
 * absences, so they are always emitted. When a real signal is simply empty (no roster
 * loaded, no jobs run), the honest empty state shows through instead of a placeholder.
 *
 * Authenticity guard: a worker's `trustScore` is EARNED RELIABILITY that evolves per job.
 * It is never presented as a per-output "safety" score.
 *
 * Pure module: types + total functions. No React, DOM, IPC, or side effects.
 */
import {
  type OpStat,
  type OpRow,
  type OpGroup,
  type OpGap,
  type OpLink,
  type OpLens,
  type OpsTone,
  healthTone,
  riskTone,
  count,
  pctText,
} from '@renderer/aiOperations/aiOperationsModel';
// Type-only (erased at runtime): the REAL shared contracts. `toAgentsInput` binds these
// ipc.* return types to the structural input below, so if the shared/workforce contracts
// drift, that binding stops compiling under the same tsc gate as the rest of the renderer.
import type { WorkerSummary } from '@neuropause/shared';
import type { WorkforceIntelligence } from '@renderer/workforce/intelligenceTypes';

/* ── Structural input (minimal, defensively optional) ──────────────────────────
 * Each shape is a documented, widened mirror of the shared type it maps from.
 * Every field is optional so a partially-loaded, empty, or malformed payload
 * degrades to an honest empty state instead of throwing or fabricating.
 */

/** A worker's compact roster view — mirrors `WorkerSummary` from ipc.workforce.workers(). */
export interface AgentWorkerInput {
  name?: string;
  role?: string;
  version?: string;
  /** 'registered' | 'idle' | 'running' | 'paused' | 'stopped' | 'errored' */
  lifecycle?: string;
  /** 'healthy' | 'degraded' | 'unhealthy' | 'unknown' */
  healthState?: string;
  /** Earned reliability in 0..1. NOT a per-output safety score. */
  trustScore?: number;
  skillCount?: number;
  /** True for the shipped archetypes; false for an installed package worker. */
  builtIn?: boolean;
}

/** The workforce-intelligence headline — mirrors `WorkforceIntelligence`. */
export interface AgentIntelligenceInput {
  totalJobs?: number;
  activeWorkers?: number;
  overallSuccessRate?: number;
  inFlight?: number;
}

/** The complete, defensively-optional input this lens derives from. */
export interface AgentsInput {
  workers?: readonly AgentWorkerInput[];
  intelligence?: AgentIntelligenceInput | null;
}

/**
 * Bind the REAL contracts to the structural input. A caller feeds `ipc.*` results
 * straight through this seam; it also statically proves the structural mirrors above
 * stay consistent with the contract — the assignments stop compiling if `WorkerSummary`
 * or `WorkforceIntelligence` drift out of shape.
 */
export function toAgentsInput(src: {
  workers?: readonly WorkerSummary[] | null;
  intelligence?: WorkforceIntelligence | null;
}): AgentsInput {
  return {
    workers: src.workers ?? undefined,
    intelligence: src.intelligence ?? undefined,
  };
}

/* ── Thresholds (presentation only; the counts they gate are all real) ── */

/** Risk floor: agents whose EARNED trust is below this are the genuine risk-threshold
 *  breaches (aligns with the low end of policy `minTrust` gating in governance). */
const TRUST_FLOOR = 0.5;
/** Trust considered well-established. */
const TRUST_TRUSTED = 0.8;

/* ── small, defensive guards ── */
function list<T>(x: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(x) ? x : [];
}
function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}
/** Render a 0..1 trust score as a score (e.g. "0.82"), never as a percentage. */
function score(n: number): string {
  return isFiniteNum(n) ? n.toFixed(2) : '—';
}

/**
 * The REAL, reusable P8.5 supply-chain capabilities. These are capability rows, not
 * metrics: the `value` column is a qualitative status (never a fabricated count). Each
 * references genuinely-shipped code (workforce/install/packaging.ts + manifest.ts).
 */
const SUPPLY_CHAIN_ROWS: readonly OpRow[] = [
  {
    label: 'Ed25519-signed packaging',
    value: 'Signed',
    sub: 'SHA-256 canonical-manifest digest, Ed25519 publisher signature — verified against a trusted key before any install',
  },
  {
    label: 'Semver versioning + rollback',
    value: 'Versioned',
    sub: 'x.y.z manifest version with engine-range compatibility; update + one-step rollback in the install lifecycle',
  },
  {
    label: '8-layer install validation',
    value: 'Validated',
    sub: 'shape · engine-compat · signature · id-collision · permission bounds · skill config · dependencies · least-privilege',
  },
  {
    label: 'Runtime governance',
    value: 'Governed',
    sub: 'installed workers composed from vetted P8.4 factories; least-privilege grants, package contributes config not code',
  },
];

/**
 * Honest capability gaps — the genuine ecosystem absences that keep the packaging /
 * sharing loop open. Each states the real architecture it would require instead of an
 * invented number, so all three are surfaced regardless of how much real data exists.
 */
const AGENTS_GAPS: readonly OpGap[] = [
  {
    capability: 'Closed share→install loop',
    requires:
      'a reinstallable package export — worker "share" emits a marketplace listing with a placeholder entry, not an installable P8.5 package',
  },
  {
    capability: 'Installable agent-package catalog',
    requires:
      'a package store — the first-party signing pack() has no production caller; no downloadable packages exist',
  },
  {
    capability: 'Capability-exchange real transfer',
    requires:
      'real artifact transfer — importing an agent "pack" increments a counter and does not install a worker',
  },
];

/** Deep-links to the canonical existing surfaces (reuse, never duplicate). */
const AGENTS_LINKS: readonly OpLink[] = [
  { label: 'AI Operations', section: 'ai-operations', icon: 'sparkles' },
  { label: 'AI Workforce', section: 'workforce', icon: 'cpu' },
  { label: 'Workforce Admin', section: 'workforce-center', icon: 'checklist' },
];

/**
 * Derive the view-ready AI Ecosystem lens. Only signals that are genuinely present
 * produce roster/intelligence stats and rows; an absent or empty signal shows the honest
 * empty state (nothing) rather than a placeholder. The supply-chain capability group,
 * the gaps, and the links are always emitted (they describe shipped reality, not input).
 */
export function summarizeAgents(input: AgentsInput): OpLens {
  const stats: OpStat[] = [];
  const groups: OpGroup[] = [];

  // ── Agent roster (real) ── ipc.workforce.workers()
  const workers = list(input.workers);
  if (workers.length > 0) {
    const total = workers.length;
    const builtIn = workers.filter((w) => w.builtIn === true).length;
    const installed = workers.filter((w) => w.builtIn === false).length;
    const healthy = workers.filter((w) => w.healthState === 'healthy').length;
    const ailing = workers.filter(
      (w) => w.healthState === 'degraded' || w.healthState === 'unhealthy',
    ).length;
    const running = workers.filter((w) => w.lifecycle === 'running').length;
    const trusts = workers.map((w) => w.trustScore).filter(isFiniteNum);
    const installedTone: OpsTone = installed > 0 ? 'blue' : 'gray';

    stats.push({
      icon: 'cpu',
      label: 'AI agents',
      value: count(total),
      tone: riskTone(ailing / total),
      hint: ailing > 0 ? `${count(ailing)} degraded/unhealthy` : `${count(healthy)} healthy`,
    });
    stats.push({
      icon: 'package',
      label: 'Built-in archetypes',
      value: count(builtIn),
      tone: installedTone,
      hint: installed > 0 ? `${count(installed)} installed` : 'no installed packages',
    });

    const rows: OpRow[] = [
      { label: 'Total agents', value: count(total) },
      { label: 'Built-in archetypes', value: count(builtIn), sub: 'ship with the app' },
      {
        label: 'Installed packages',
        value: count(installed),
        tone: installedTone,
        sub: installed > 0 ? undefined : 'no installable packages exist yet (see gaps)',
      },
      { label: 'Healthy', value: count(healthy), tone: riskTone(ailing / total) },
    ];
    if (ailing > 0) {
      rows.push({
        label: 'Degraded / unhealthy',
        value: count(ailing),
        tone: riskTone(ailing / total),
      });
    }
    if (running > 0) rows.push({ label: 'Running now', value: count(running) });

    if (trusts.length > 0) {
      const mean = trusts.reduce((a, b) => a + b, 0) / trusts.length;
      const trusted = trusts.filter((t) => t >= TRUST_TRUSTED).length;
      const below = trusts.filter((t) => t < TRUST_FLOOR).length;

      stats.push({
        icon: 'verified',
        label: 'Mean agent trust',
        value: score(mean),
        tone: healthTone(mean),
        hint: `${count(below)} below floor`,
      });

      rows.push(
        {
          label: 'Mean trust',
          value: score(mean),
          tone: healthTone(mean),
          sub: 'earned reliability, evolves per job',
        },
        {
          label: `Trusted (≥ ${score(TRUST_TRUSTED)})`,
          value: count(trusted),
          tone: healthTone(trusted / trusts.length),
        },
        {
          label: `Below trust floor (< ${score(TRUST_FLOOR)})`,
          value: count(below),
          tone: riskTone(below / trusts.length),
          sub: 'risk threshold',
        },
      );
    }

    groups.push({
      title: 'Agent roster (real)',
      rows,
      note: 'Roster from ipc.workforce.workers() — built-in archetypes plus any installed packages. Trust is earned reliability, not a safety score.',
    });
  }

  // ── Roster intelligence (real, optional headline) ── ipc.workforce.intelligence()
  const intel = input.intelligence;
  if (intel && isFiniteNum(intel.totalJobs) && intel.totalJobs > 0) {
    const jobs = intel.totalJobs;
    const rate = intel.overallSuccessRate;

    if (isFiniteNum(rate)) {
      stats.push({
        icon: 'gauge',
        label: 'Roster success rate',
        value: pctText(rate),
        tone: healthTone(rate),
        hint: `${count(jobs)} jobs`,
      });
    }

    const rows: OpRow[] = [{ label: 'Jobs run', value: count(jobs) }];
    if (isFiniteNum(intel.activeWorkers)) {
      rows.push({ label: 'Active agents', value: count(intel.activeWorkers) });
    }
    if (isFiniteNum(intel.inFlight)) rows.push({ label: 'In flight', value: count(intel.inFlight) });
    if (isFiniteNum(rate)) {
      rows.push({ label: 'Overall success rate', value: pctText(rate), tone: healthTone(rate) });
    }

    groups.push({
      title: 'Roster intelligence (real)',
      rows,
      note: 'Aggregated by ipc.workforce.intelligence() over the existing job store.',
    });
  }

  // ── Agent supply chain (real, reused) ── ALWAYS present: describes the shipped P8.5
  //    Installable Workers machinery (real code), not data derived from `input`. It emits
  //    no counts, so it is never a placeholder for a missing value.
  groups.push({
    title: 'Agent supply chain (real, reused)',
    rows: [...SUPPLY_CHAIN_ROWS],
    note: 'Reused from the shipped P8.5 Installable Workers stack — packaging signing, the 8-layer package validator, and governed least-privilege composition. This verification/install machinery is real and reusable; what is missing is the packaging→distribution pipeline that would feed it (see gaps).',
  });

  return { stats, groups, gaps: [...AGENTS_GAPS], links: [...AGENTS_LINKS] };
}
