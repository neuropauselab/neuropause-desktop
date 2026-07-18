/**
 * Developer Experience lens — Platform Ecosystem workspace (Phase 5).
 *
 * A PURE, IO-free derivation over EXISTING read-only `ipc.*` returns that already back the
 * Developer Portal. It COMPOSES the developer-facing surface the platform genuinely ships —
 * hashed API keys, OAuth applications, the public REST route index, and the real gateway
 * usage analytics — into one honest "Developer Experience" tab. It adds NO new runtime, IPC
 * channel, SDK, or service.
 *
 * Real signals (verified against lib/ipc.ts + @neuropause/shared):
 *   - ipc.ecosystem.keys()             -> ApiKey[]                    (hashed; active/revoked posture)
 *   - ipc.developerPlatform.analytics()-> DeveloperPlatformAnalytics  (requests / allowed / denied /
 *                                          rateLimited / unauthorized / gateway p95 — from the real
 *                                          usage ledger; `requests === allowed + denied`)
 *   - ipc.ecosystem.oauthApps()        -> OAuthApplication[]          (grant types + redirect URIs)
 *   - ipc.api.routes()                 -> ApiRouteInfo[]              (public REST surface; drives OpenAPI)
 *
 * Authenticity contract:
 *   - Every stat/row reads a REAL field. Nothing is invented.
 *   - Developer usage is REAL but empty-until-traffic: when `requests === 0` the honest zero shows
 *     through and the latency / decision-breakdown stats are SUPPRESSED (never a fabricated 0 ms or
 *     100 %).
 *   - The four things the developer platform genuinely cannot do are surfaced as honest OpGaps
 *     stating the real architecture they would require, rather than faked values.
 *   - When no real signal is present at all, the lens is genuinely empty; the architectural gaps and
 *     the Developer Portal reuse link — truths independent of data — always persist.
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

/* ── Minimal structural inputs (every field defensively optional; real field names) ──────── */

/** Structural subset of ecosystem `ApiKey` (ipc.ecosystem.keys()[]). Hashed — carries no secret. */
export interface ApiKeyLike {
  id?: string;
  name?: string;
  /** ISO timestamp when the key was revoked, or null while active. */
  revokedAt?: string | null;
  /** ISO expiry, or null for a non-expiring key. */
  expiresAt?: string | null;
  /** ISO of last use, or null if the key has never been used. */
  lastUsedAt?: string | null;
}

/** Structural subset of `DeveloperPlatformAnalytics` (ipc.developerPlatform.analytics()). */
export interface DeveloperAnalyticsLike {
  windowDays?: number;
  /** Total requests in the window — 0 until developer traffic actually flows. */
  requests?: number;
  /** Requests the gateway allowed (status < 400). */
  allowed?: number;
  /** Requests the gateway denied (status >= 400). Invariant: `requests === allowed + denied`. */
  denied?: number;
  /** Denied subset — HTTP 429. */
  rateLimited?: number;
  /** Denied subset — HTTP 401/403. */
  unauthorized?: number;
  /** Real gateway p95 latency, in milliseconds. */
  p95LatencyMs?: number;
  /** Top routes by request volume. */
  topRoutes?: readonly { route?: string; requests?: number }[];
}

/** Structural subset of ecosystem `OAuthApplication` (ipc.ecosystem.oauthApps()[]). */
export interface OAuthAppLike {
  id?: string;
  name?: string;
  /** 'authorization_code' | 'client_credentials' | 'refresh_token' — only client_credentials is wired. */
  grantTypes?: readonly string[];
  redirectUris?: readonly string[];
}

/** Structural subset of `ApiRouteInfo` (ipc.api.routes()[]). */
export interface ApiRouteLike {
  method?: string;
  path?: string;
  scope?: string;
}

/** The real, read-only Developer-Experience signals this lens composes. All defensive/optional. */
export interface DeveloperInput {
  /** Developer API keys (hashed). */
  keys?: readonly ApiKeyLike[] | null;
  /** Real developer usage analytics — empty-until-traffic (honest zero). */
  analytics?: DeveloperAnalyticsLike | null;
  /** Developer OAuth applications. */
  apps?: readonly OAuthAppLike[] | null;
  /** Public REST route index (drives OpenAPI + the API Explorer in the Developer Portal). */
  routes?: readonly ApiRouteLike[] | null;
}

/* ── Small pure helpers ──────────────────────────────────────────────────────────────────── */

function arr<T>(v: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isRevoked(k: ApiKeyLike | null | undefined): boolean {
  return k?.revokedAt != null;
}

/**
 * p95 latency tone — the health direction INVERTED (lower is better), so it reads as risk:
 * green comfortably under budget, orange when elevated, red once the budget is breached.
 * The 500 ms p95 budget mirrors the established sandbox Lab-panel threshold
 * (`latency p95 > 500 → warn`), reused here for consistency. Presentation only: the surfaced
 * value is always the real measured gateway p95 in ms — the budget colours it, never replaces it.
 */
export const P95_BUDGET_MS = 500;
function p95Tone(ms: number): OpsTone {
  if (!Number.isFinite(ms)) return 'gray';
  if (ms > P95_BUDGET_MS) return 'red';
  if (ms > P95_BUDGET_MS / 2) return 'orange';
  return 'green';
}

/** Highest-volume real route, or null when none carry a name. */
function topRoute(a: DeveloperAnalyticsLike | null): { route: string; requests: number } | null {
  let best: { route: string; requests: number } | null = null;
  for (const r of arr(a?.topRoutes)) {
    const route = typeof r?.route === 'string' ? r.route.trim() : '';
    if (route === '') continue;
    const requests = num(r?.requests);
    if (best === null || requests > best.requests) best = { route, requests };
  }
  return best;
}

/* ── Always-present honesty: architectural gaps + the canonical reuse link ───────────────── */

const GAPS: OpGap[] = [
  {
    capability: 'Project templates / scaffolding',
    requires: 'a scaffolder — no init/new command or template files exist',
    note: 'The template registry lists scaffold commands as catalog strings; none are executable.',
  },
  {
    capability: 'Plugin-author test/debug harness',
    requires: 'a local dev loop — the CLI is API-only',
    note: 'SDKs are published artifacts; there is no local run/inspect/replay loop for authors.',
  },
  {
    capability: 'Package (.npkg) producer',
    requires: 'build tooling — the package service only consumes artifacts',
    note: 'packageService verifies/installs signed packages; nothing produces one from source.',
  },
  {
    capability: 'authorization_code OAuth for developer apps',
    requires:
      'an /authorize + consent flow — redirectUris are stored but unused (client_credentials works today)',
    note: 'OAuth apps persist redirectUris and grant types, but only client_credentials is wired.',
  },
];

const LINKS: OpLink[] = [{ label: 'Developer Portal', section: 'developer', icon: 'code' }];

/* ── The lens ────────────────────────────────────────────────────────────────────────────── */

export function summarizeDeveloper(input: DeveloperInput): OpLens {
  const keys = arr(input?.keys);
  const apps = arr(input?.apps);
  const routes = arr(input?.routes);
  const analytics = input?.analytics ?? null;

  // Honest empty state: no real Developer-Experience signal is present at all. The architectural
  // gaps + the Developer Portal reuse link are truths independent of data and always persist;
  // stats/groups stay genuinely empty (never a fabricated zero).
  const hasSignal = keys.length > 0 || apps.length > 0 || routes.length > 0 || analytics != null;
  if (!hasSignal) {
    return { stats: [], groups: [], gaps: GAPS, links: LINKS };
  }

  // ── Real key posture (deterministic; no wall-clock needed) ──
  const activeKeys = keys.filter((k) => !isRevoked(k)).length;
  const revokedKeys = keys.length - activeKeys;
  const usedKeys = keys.filter((k) => k?.lastUsedAt != null).length;
  const activeShare = keys.length > 0 ? activeKeys / keys.length : Number.NaN;

  // ── Real usage (empty-until-traffic → honest zero) ──
  const hasAnalytics = analytics != null;
  const requests = num(analytics?.requests);
  const allowed = num(analytics?.allowed);
  const denied = num(analytics?.denied);
  const rateLimited = num(analytics?.rateLimited);
  const unauthorized = num(analytics?.unauthorized);
  const p95 = num(analytics?.p95LatencyMs);
  const windowDays = num(analytics?.windowDays);
  const hasTraffic = hasAnalytics && requests > 0;
  const allowedShare = hasTraffic ? allowed / requests : Number.NaN;
  const deniedShare = hasTraffic ? denied / requests : Number.NaN;

  /* stats — every value reads a real field */
  const stats: OpStat[] = [];

  // API keys — active/revoked posture; tone = health of the active share.
  if (keys.length > 0) {
    stats.push({
      icon: 'lock',
      label: 'API keys',
      value: count(keys.length),
      tone: healthTone(activeShare),
      hint: `${count(activeKeys)} active, ${count(revokedKeys)} revoked`,
    });
  }

  // Developer requests — real analytics; 0 is honest (empty-until-traffic), not hidden.
  if (hasAnalytics) {
    stats.push({
      icon: 'activity',
      label: 'Developer requests',
      value: count(requests),
      tone: hasTraffic ? healthTone(allowedShare) : 'gray',
      hint: hasTraffic ? `last ${count(windowDays)}d · ${pctText(allowedShare)} allowed` : 'no developer traffic yet',
    });
  }

  // p95 latency — only meaningful once traffic exists; suppressed at zero so we never present a
  // fabricated 0 ms. Tone is health-inverted against the 500 ms budget.
  if (hasTraffic) {
    stats.push({
      icon: 'gauge',
      label: 'p95 latency',
      value: `${count(p95)}ms`,
      tone: p95Tone(p95),
      hint: `gateway p95 · ${count(P95_BUDGET_MS)}ms budget`,
    });
  }

  // Public API routes — the real REST surface that drives OpenAPI + the API Explorer.
  if (routes.length > 0) {
    stats.push({
      icon: 'code',
      label: 'API routes',
      value: count(routes.length),
      tone: 'blue',
      hint: 'public REST surface',
    });
  }

  /* groups */
  const groups: OpGroup[] = [];

  // Group 1 — the real, wired developer surface (deterministic; needs no traffic). References the
  // OpenAPI / API Explorer that already live in the Developer Portal rather than re-implementing them.
  {
    const rows: OpRow[] = [];
    if (keys.length > 0) {
      rows.push({
        label: 'API keys',
        value: count(keys.length),
        tone: healthTone(activeShare),
        sub: `${count(activeKeys)} active · ${count(revokedKeys)} revoked · ${count(usedKeys)} used`,
      });
    }
    if (apps.length > 0) {
      const clientCred = apps.filter((a) => arr(a?.grantTypes).includes('client_credentials')).length;
      rows.push({
        label: 'OAuth applications',
        value: count(apps.length),
        tone: 'blue',
        sub: `${count(clientCred)} client_credentials (the wired grant)`,
      });
    }
    if (routes.length > 0) {
      rows.push({
        label: 'Public API routes',
        value: count(routes.length),
        tone: 'blue',
        sub: 'REST surface behind the gateway',
      });
    }
    if (rows.length > 0) {
      groups.push({
        title: 'Developer platform (real, wired)',
        rows,
        note: 'OpenAPI 3.1 + the API Explorer live in the Developer Portal — referenced here, not re-implemented.',
      });
    }
  }

  // Group 2 — live gateway usage. Real analytics, honestly empty until traffic flows.
  if (hasAnalytics) {
    const rows: OpRow[] = [
      {
        label: 'Requests',
        value: count(requests),
        tone: hasTraffic ? 'blue' : 'gray',
        sub: `last ${count(windowDays)}d`,
      },
    ];
    if (hasTraffic) {
      rows.push({
        label: 'Allowed',
        value: `${count(allowed)} (${pctText(allowedShare)})`,
        tone: healthTone(allowedShare),
      });
      rows.push({
        label: 'Denied',
        value: `${count(denied)} (${pctText(deniedShare)})`,
        tone: riskTone(deniedShare),
        sub: `${count(rateLimited)} rate-limited · ${count(unauthorized)} unauthorized`,
      });
      rows.push({
        label: 'p95 latency',
        value: `${count(p95)}ms`,
        tone: p95Tone(p95),
        sub: `${count(P95_BUDGET_MS)}ms budget`,
      });
      const top = topRoute(analytics);
      if (top) {
        rows.push({ label: 'Top route', value: count(top.requests), tone: 'blue', sub: top.route });
      }
    }
    groups.push({
      title: 'Gateway usage (real)',
      rows,
      note: hasTraffic
        ? 'Derived from the real usage ledger + gateway p95.'
        : 'Real analytics, empty until developer requests flow — honest zero, no fabricated numbers.',
    });
  }

  return { stats, groups, gaps: GAPS, links: LINKS };
}
