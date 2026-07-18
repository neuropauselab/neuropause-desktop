/**
 * Platform Analytics — pure derivation for the Phase 5 "Platform Ecosystem" workspace's
 * Platform Analytics tab (Sub-Agent 8).
 *
 * Like every tab in the ecosystem workspace this adds NO runtime, IPC channel, engine, or
 * store — `summarizeAnalytics` is a PURE function over data the renderer already fetched from
 * EXISTING `ipc.*` methods, composed into one honest analytics lens:
 *
 *   - ipc.developerPlatform.analytics() → DeveloperPlatformAnalytics
 *       REAL gateway/developer usage: request volume, by-status decisions, p95 latency.
 *   - ipc.marketplace.analytics()       → MarketplaceAnalytics
 *       REAL computed marketplace analytics: adoption, installs, packages, publishers, updates.
 *       (rollbackRate / byChannel carry denominator/metadata caveats and are deliberately NOT
 *        surfaced as headline numbers.)
 *   - ipc.ecosystem.analytics()         → EcosystemAnalytics  (optional rollup)
 *       REAL rollup, but a few of its inputs are demo-seeded and empty in production. Only the
 *       genuinely-real, non-demo fields are surfaced (listings / installs / developers / usage).
 *   - computeMaturity() (renderer-static) → CapabilityMaturity
 *       REAL deterministic capability-maturity %, derived from the canonical capability registry.
 *
 * Authenticity is the dominant contract (analytics is where fabrication does the most damage):
 *   • Every stat/row is read from a REAL, present field; absent sources surface an honest empty
 *     state (no stat/row), never a placeholder or invented number.
 *   • DEMO-SEEDED analytics — the partner directory and exchange packs — are gated OFF in
 *     production (empty stores; see main/ecosystem/exchange/ecosystemProdSeed.test.ts). They are
 *     surfaced ONLY as honest, labeled OpGaps and are NEVER read as earned numbers, even if a
 *     payload happens to carry non-zero counts (e.g. a dev build with demo seeds on).
 *
 * The input shapes below mirror @neuropause/shared (developerPlatform / marketplace /
 * ecosystem-exchange types) and the capability registry, but are a minimal, defensively-optional
 * subset so partial or absent payloads degrade gracefully rather than throwing.
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
  count,
  pctText,
} from '@renderer/aiOperations/aiOperationsModel';
import type { CapabilityMaturity } from '@renderer/capability/capabilityRegistry';

/* ─────────────────────────── Input shapes (minimal, optional) ─────────────────────────── */

/**
 * Subset of `DeveloperPlatformAnalytics` (ipc.developerPlatform.analytics()) — REAL gateway/
 * developer usage over a rolling window. All fields zero-until-real.
 */
export interface DeveloperAnalyticsLike {
  /** Rolling window the counts cover, in days. */
  windowDays?: number | null;
  /** Total gateway requests in the window. */
  requests?: number | null;
  /** Allowed (2xx-eligible) gateway decisions. */
  allowed?: number | null;
  /** Denied gateway decisions. */
  denied?: number | null;
  /** Requests rejected by rate-limiting. */
  rateLimited?: number | null;
  /** Requests rejected for missing/invalid auth. */
  unauthorized?: number | null;
  /** 95th-percentile gateway latency, in milliseconds. */
  p95LatencyMs?: number | null;
}

/**
 * Subset of `MarketplaceAnalytics` (ipc.marketplace.analytics()) — REAL computed catalog
 * analytics. `rollbackRate` and `byChannel` are intentionally omitted here: their denominator /
 * channel metadata carries caveats, so they are not surfaced as headline numbers.
 */
export interface MarketplaceAnalyticsLike {
  totalPackages?: number | null;
  totalPublishers?: number | null;
  totalInstalls?: number | null;
  updatesAvailable?: number | null;
  /** installed / catalog, 0..1. The headline adoption signal. */
  adoption?: number | null;
}

/**
 * Subset of `EcosystemAnalytics` (ipc.ecosystem.analytics()) — a REAL rollup. Only the
 * genuinely-real, non-demo fields are declared for surfacing. `partners` and `packs` ARE declared
 * (so the contract is explicit) but are DEMO-GATED — empty in production and NEVER surfaced as
 * numbers; they appear only as honest OpGaps.
 */
export interface EcosystemAnalyticsLike {
  totalListings?: number | null;
  publishedListings?: number | null;
  certifiedListings?: number | null;
  totalInstalls?: number | null;
  activeDevelopers?: number | null;
  activeOrganizations?: number | null;
  downloads30d?: number | null;
  /** Real gateway usage rollup (30-day). */
  usage?: { requests30d?: number | null; computeUnits30d?: number | null; p95LatencyMs?: number | null } | null;
  /** DEMO-GATED — partner directory is empty in production. Deliberately NEVER surfaced. */
  partners?: number | null;
  /** DEMO-GATED — exchange packs are empty in production. Deliberately NEVER surfaced. */
  packs?: number | null;
}

/**
 * Subset of the canonical `CapabilityMaturity` (computeMaturity()) — REAL deterministic maturity.
 * `maturityPct` / `completionPct` are 0..100 integers (converted to 0..1 for tone/pctText).
 */
export type MaturityLike = Partial<CapabilityMaturity>;

/** The structural input `summarizeAnalytics` derives from. Every field is optional. */
export interface AnalyticsInput {
  /** ipc.developerPlatform.analytics() */
  developer?: DeveloperAnalyticsLike | null;
  /** ipc.marketplace.analytics() */
  marketplace?: MarketplaceAnalyticsLike | null;
  /** ipc.ecosystem.analytics() — optional real rollup (non-demo fields only). */
  ecosystem?: EcosystemAnalyticsLike | null;
  /** computeMaturity() — real deterministic capability maturity. */
  maturity?: MaturityLike | null;
}

/* ─────────────────────────── Local helpers (pure) ─────────────────────────── */

/** True only for a real, finite number (rejects null/undefined/NaN/Infinity). */
function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Safe millisecond formatting for a latency value (never renders NaN/undefined). */
function msText(ms: number | null | undefined): string {
  return isNum(ms) ? `${Math.round(ms)} ms` : '—';
}

/** Safe 0..1 ratio (a / b), guarding a zero/absent denominator. */
function ratio(a: number | null | undefined, b: number | null | undefined): number {
  if (!isNum(a) || !isNum(b) || b === 0) return Number.NaN;
  return a / b;
}

/**
 * Presentation banding for a p95 latency in ms (lower is better). This is a PRESENTATION tone
 * only — the millisecond value itself is the real, source-derived signal.
 */
function latencyTone(ms: number | null | undefined): OpsTone {
  if (!isNum(ms)) return 'gray';
  if (ms <= 300) return 'green';
  if (ms <= 1200) return 'orange';
  return 'red';
}

/* ─────────────────────────── Derivation ─────────────────────────── */

/**
 * Derive the view-ready Platform Analytics lens from already-fetched IPC data. Pure and total:
 * any subset of inputs (including none) yields a valid `OpLens` whose stats and groups reflect
 * only real, present fields, with the honest demo-gating gaps and deep-links always present.
 */
export function summarizeAnalytics(input: AnalyticsInput = {}): OpLens {
  const developer = input?.developer ?? undefined;
  const marketplace = input?.marketplace ?? undefined;
  const ecosystem = input?.ecosystem ?? undefined;
  const maturity = input?.maturity ?? undefined;

  const stats: OpStat[] = [];
  const groups: OpGroup[] = [];

  // Maturity is a 0..100 score → convert to a 0..1 ratio for pctText/healthTone.
  const hasMaturity = isNum(maturity?.maturityPct);
  const maturity01 = hasMaturity ? (maturity!.maturityPct as number) / 100 : Number.NaN;
  const hasCompletion = isNum(maturity?.completionPct);
  const completion01 = hasCompletion ? (maturity!.completionPct as number) / 100 : Number.NaN;

  /* ── Stats (headline metrics, each backed by a real, present field) ── */
  if (isNum(developer?.requests)) {
    stats.push({
      icon: 'activity',
      label: 'Gateway requests',
      value: count(developer!.requests),
      hint: isNum(developer?.windowDays) ? `${Math.round(developer!.windowDays!)}-day window` : undefined,
    });
  }
  if (isNum(developer?.p95LatencyMs)) {
    stats.push({
      icon: 'gauge',
      label: 'Gateway p95',
      value: msText(developer!.p95LatencyMs),
      tone: latencyTone(developer!.p95LatencyMs),
      hint: 'gateway latency',
    });
  }
  if (isNum(marketplace?.adoption)) {
    stats.push({
      icon: 'store',
      label: 'Marketplace adoption',
      value: pctText(marketplace!.adoption),
      tone: healthTone(marketplace!.adoption as number),
      hint: 'installed / catalog',
    });
  }
  if (hasMaturity) {
    stats.push({
      icon: 'layers',
      label: 'Capability maturity',
      value: pctText(maturity01),
      tone: healthTone(maturity01),
      hint: 'real / surveyed capabilities',
    });
  }

  /* ── Group: Real platform analytics (usage/latency · marketplace · maturity) ── */
  const realRows: OpRow[] = [];

  // Usage / latency (developer platform — real gateway ledger).
  if (developer) {
    if (isNum(developer.requests)) {
      realRows.push({
        label: 'Gateway requests',
        value: count(developer.requests),
        sub: isNum(developer.windowDays) ? `${Math.round(developer.windowDays!)}-day window` : undefined,
      });
      const successRatio = ratio(developer.allowed, developer.requests);
      realRows.push({
        label: 'Allowed / denied',
        value: `${count(developer.allowed)} / ${count(developer.denied)}`,
        tone: healthTone(successRatio),
        sub: 'gateway decisions',
      });
      if (isNum(developer.rateLimited) || isNum(developer.unauthorized)) {
        realRows.push({
          label: 'Rate limited',
          value: count(developer.rateLimited),
          sub: `${count(developer.unauthorized)} unauthorized`,
        });
      }
    }
    if (isNum(developer.p95LatencyMs)) {
      realRows.push({
        label: 'Gateway p95 latency',
        value: msText(developer.p95LatencyMs),
        tone: latencyTone(developer.p95LatencyMs),
      });
    }
  }

  // Marketplace (real computed analytics).
  if (marketplace) {
    if (isNum(marketplace.adoption)) {
      realRows.push({
        label: 'Marketplace adoption',
        value: pctText(marketplace.adoption),
        tone: healthTone(marketplace.adoption as number),
        sub: 'installed / catalog',
      });
    }
    if (isNum(marketplace.totalInstalls)) {
      realRows.push({ label: 'Marketplace installs', value: count(marketplace.totalInstalls) });
    }
    if (isNum(marketplace.totalPackages)) {
      realRows.push({
        label: 'Marketplace packages',
        value: count(marketplace.totalPackages),
        sub: isNum(marketplace.totalPublishers) ? `${count(marketplace.totalPublishers)} publishers` : undefined,
      });
    }
    if (isNum(marketplace.updatesAvailable)) {
      realRows.push({ label: 'Updates available', value: count(marketplace.updatesAvailable) });
    }
  }

  // Capability maturity (real deterministic registry math).
  if (hasMaturity) {
    realRows.push({
      label: 'Capability maturity',
      value: pctText(maturity01),
      tone: healthTone(maturity01),
      sub:
        isNum(maturity?.real) && isNum(maturity?.total)
          ? `${count(maturity!.real)}/${count(maturity!.total)} capabilities real`
          : undefined,
    });
  }
  if (hasCompletion) {
    realRows.push({
      label: 'Production-complete',
      value: pctText(completion01),
      tone: healthTone(completion01),
      sub: 'strictest bar',
    });
  }

  if (realRows.length > 0) {
    groups.push({
      title: 'Real platform analytics',
      rows: realRows,
      note: 'Every line is read from a real source (developer gateway ledger, computed marketplace analytics, capability registry).',
    });
  }

  /* ── Group: Ecosystem rollup (real, non-demo fields only) ── */
  if (ecosystem) {
    const ecoRows: OpRow[] = [];
    if (isNum(ecosystem.totalListings)) {
      ecoRows.push({
        label: 'Listings',
        value: count(ecosystem.totalListings),
        sub:
          isNum(ecosystem.publishedListings) || isNum(ecosystem.certifiedListings)
            ? `${count(ecosystem.publishedListings)} published · ${count(ecosystem.certifiedListings)} certified`
            : undefined,
      });
    }
    if (isNum(ecosystem.totalInstalls)) {
      ecoRows.push({ label: 'Total installs', value: count(ecosystem.totalInstalls) });
    }
    if (isNum(ecosystem.activeDevelopers)) {
      ecoRows.push({ label: 'Active developers', value: count(ecosystem.activeDevelopers) });
    }
    if (isNum(ecosystem.activeOrganizations)) {
      ecoRows.push({ label: 'Active organizations', value: count(ecosystem.activeOrganizations) });
    }
    if (isNum(ecosystem.downloads30d)) {
      ecoRows.push({ label: 'Downloads (30d)', value: count(ecosystem.downloads30d) });
    }
    if (isNum(ecosystem.usage?.requests30d)) {
      ecoRows.push({ label: 'Gateway requests (30d)', value: count(ecosystem.usage!.requests30d) });
    }
    if (isNum(ecosystem.usage?.p95LatencyMs)) {
      ecoRows.push({
        label: 'Gateway p95 (30d)',
        value: msText(ecosystem.usage!.p95LatencyMs),
        tone: latencyTone(ecosystem.usage!.p95LatencyMs),
      });
    }
    // NOTE: ecosystem.partners / ecosystem.packs are DELIBERATELY not read here — they are
    // demo-seeded and empty in production, and are surfaced only as honest gaps below.
    if (ecoRows.length > 0) {
      groups.push({
        title: 'Ecosystem rollup (real fields only)',
        rows: ecoRows,
        note: 'Partner and pack figures are excluded — the partner directory and exchange packs are demo-seeded and empty in production.',
      });
    }
  }

  /* ── Gaps: demo-gated analytics that do not exist in production (always honest, always present) ── */
  const gaps: OpGap[] = [
    {
      capability: 'Partner analytics',
      requires: 'real partner records — the partner directory is demo-only and empty in production',
    },
    {
      capability: 'Pack / exchange analytics',
      requires: 'real exchange activity — packs are demo-seeded and empty in production',
    },
  ];

  /* ── Links: deep-links to the canonical existing surfaces (reuse, not duplicate) ── */
  const links: OpLink[] = [
    { label: 'Enterprise Intelligence', section: 'intelligence' },
    { label: 'Developer', section: 'developer' },
  ];

  return { stats, groups, gaps, links };
}
