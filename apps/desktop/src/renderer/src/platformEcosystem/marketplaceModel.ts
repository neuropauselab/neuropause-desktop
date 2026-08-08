/**
 * Platform Ecosystem (Phase 5) — "Marketplace Evolution" tab lens.
 *
 * A PURE, DESCRIPTIVE derivation over data the platform already produces about the
 * Enterprise Marketplace (P9) and the commercial metering ledger (P20). It reports
 * what the catalog + analytics genuinely contain and nothing more. It adds NO new
 * IPC channel, engine, store, or service — it is called with the results of
 * EXISTING channels and re-shapes them into the shared `OpLens` contract.
 *
 * Authenticity contract (this is the point of the tab):
 *   - The catalog today is populated by 5 honestly-labeled "(Example)" seed
 *     listings run through the REAL scan + Ed25519 signing pipeline at first launch.
 *     They are surfaced AS examples, never counted as an earned catalog.
 *   - Marketplace analytics are real-computed, but with two verified caveats that
 *     are stated openly rather than hidden: `byChannel` collapses to "stable" (there
 *     is no channel field on versions — `channelFor` defaults to 'stable'), and
 *     `rollbackRate` is stubbed 0 (the composition root passes `rollbacks: 0`; there
 *     is no rollback telemetry yet).
 *   - Revenue is the commercial metering ledger — a real, zero-until-real figure.
 *     It is surfaced as an honest zero and NEVER fabricated from listing prices;
 *     marketplace listings do not transact.
 * Every capability the platform does not genuinely have (independent review,
 * multi-publisher identity, channel promotion, rollback telemetry) is surfaced as
 * an honest, labeled `OpGap`. When a real signal is simply empty, the honest empty
 * state shows through — the tab renders only its gaps + deep-links.
 *
 * Intended (reuse-only) wiring — the real method is `catalog()` (there is no
 * `ipc.marketplace.list()`); every field below is structurally compatible with the
 * real payloads (verified against lib/ipc.ts + @neuropause/shared):
 *   summarizeMarketplace({
 *     listings:  await ipc.marketplace.catalog(),   // MarketplaceEntry[]
 *     analytics: await ipc.marketplace.analytics(), // MarketplaceAnalytics
 *     metering:  await ipc.commercial.metering(),   // CommercialMetering
 *   })
 */
import {
  type OpStat,
  type OpRow,
  type OpGroup,
  type OpGap,
  type OpLink,
  type OpLens,
  healthTone,
  count,
  pctText,
} from '@renderer/aiOperations/aiOperationsModel';

/* ── Minimal structural inputs ───────────────────────────────────────────────
 * Every field is defensively optional so partial/empty payloads are safe. Field
 * names/types mirror the REAL sources, so a real `MarketplaceEntry` /
 * `MarketplaceAnalytics` / `CommercialMetering` value is structurally assignable
 * here. Nothing is invented — notably, an entry carries NO price field, so listing
 * prices can never be misread as revenue.
 */

/** Subset of `MarketplaceEntry` (one governed catalog row) from `ipc.marketplace.catalog()`. */
export interface MarketEntry {
  id?: string;
  name?: string;
  /** `MarketplacePackageType`: 'worker' | 'connector' | 'template' | … */
  packageType?: string;
  /** `ReleaseChannel`: 'stable' | 'beta' | 'canary' | 'lts' (collapses to 'stable' today). */
  channel?: string;
  publisher?: { id?: string; name?: string; tier?: string; trustScore?: number };
  signed?: boolean;
  certified?: boolean;
  installs?: number;
  /** `InstallState`: 'not_installed' | 'installed' | 'update_available' | 'disabled'. */
  installState?: string;
  version?: string;
}

/** Subset of `MarketplaceAnalytics` from `ipc.marketplace.analytics()` (real-computed). */
export interface MarketAnalytics {
  totalPackages?: number;
  totalPublishers?: number;
  totalInstalls?: number;
  updatesAvailable?: number;
  /** Real field, but currently stubbed 0 (no rollback telemetry). */
  rollbackRate?: number;
  byType?: readonly { type?: string; count?: number; installs?: number }[];
  /** Real field, but collapses to a single 'stable' bucket (no channel field on versions). */
  byChannel?: readonly { channel?: string; count?: number }[];
  topPublishers?: readonly { id?: string; name?: string; installs?: number; tier?: string }[];
  /** installed / total, 0..1. */
  adoption?: number;
}

/** Subset of `CommercialMetering` from `ipc.commercial.metering()` — the real revenue/usage ledger. */
export interface MarketMetering {
  /** Metered monthly spend — the honest revenue figure (zero until real). */
  monthlySpend?: number;
  requests30d?: number;
  aiCostUsd?: number;
  currency?: string;
  note?: string;
}

/** The (defensively optional) input to the Marketplace Evolution derivation. */
export interface MarketplaceInput {
  /** From `ipc.marketplace.catalog()`. */
  listings?: readonly MarketEntry[] | null;
  /** From `ipc.marketplace.analytics()`. */
  analytics?: MarketAnalytics | null;
  /** From `ipc.commercial.metering()`. */
  metering?: MarketMetering | null;
}

/* ── small pure helpers ── */

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function arr<T>(v: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(v) ? v : [];
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function str(v: string | null | undefined): string {
  return typeof v === 'string' ? v : '';
}

/** A listing is a seed example iff its name is honestly suffixed "(Example)". */
function isExample(name: string): boolean {
  return /\(example\)/i.test(name);
}

/** 'automation_pack' → 'Automation pack'. Never invents a label. */
function humanizeType(t: string): string {
  if (!t) return 'Unknown';
  const s = t.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Honest money formatting. `money(0, 'USD')` → "$0" — never a fabricated figure. */
function money(n: number, currency: string): string {
  const v = Math.round(n * 100) / 100;
  const body = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return currency === 'USD' || currency === '' ? `$${body}` : `${body} ${currency}`;
}

/**
 * The four genuine architectural absences of this tab. They are constant — the
 * marketplace lacks these regardless of how populated the catalog is — so they
 * render in every state, populated or empty. This is what keeps the tab honestly
 * descriptive rather than pretending the ecosystem is further along than it is.
 */
function marketplaceGaps(): OpGap[] {
  return [
    {
      capability: 'Independent reviewer / separation of duties',
      requires: 'a reviewer role — today the submitter is also the reviewer (self-review)',
    },
    {
      capability: 'Multi-publisher identity',
      requires: 'a publisher-identity registry — one self-publisher today',
    },
    {
      capability: 'Channel promotion (canary→beta→stable)',
      requires: 'a channel field on versions — none exists (byChannel collapses to stable)',
    },
    {
      capability: 'Rollback-rate analytics',
      requires: 'real rollback telemetry — rollbackRate is currently stubbed 0',
    },
  ];
}

/** Deep-links to the canonical surfaces this lens is derived from (reuse, not duplicate). */
function marketplaceLinks(): OpLink[] {
  return [
    { label: 'Enterprise Marketplace', section: 'marketplace', icon: 'store' },
    { label: 'Ecosystem storefront', section: 'ecosystem', icon: 'globe' },
  ];
}

/**
 * Derive the Marketplace Evolution lens. Pure: same input → same output; no IPC,
 * no clock, no DOM. Only real, present signals produce stats/rows; absent signals
 * fall through to the honest empty state (gaps + links only).
 */
export function summarizeMarketplace(input: MarketplaceInput): OpLens {
  const stats: OpStat[] = [];
  const groups: OpGroup[] = [];

  const listings = arr(input.listings);
  const analytics = input.analytics ?? null;
  const metering = input.metering ?? null;

  const hasListings = listings.length > 0;
  const exampleCount = listings.filter((e) => isExample(str(e?.name))).length;
  const earnedCount = listings.length - exampleCount;

  /* Package-type buckets — prefer real analytics, else derive from the catalog. */
  const analyticsByType = arr(analytics?.byType).filter((t) => num(t?.count) > 0);
  let typeBuckets: { type: string; count: number; installs: number }[];
  if (analyticsByType.length > 0) {
    typeBuckets = analyticsByType.map((t) => ({
      type: str(t?.type),
      count: num(t?.count),
      installs: num(t?.installs),
    }));
  } else if (hasListings) {
    const m = new Map<string, { count: number; installs: number }>();
    for (const e of listings) {
      const t = str(e?.packageType) || 'unknown';
      const cur = m.get(t) ?? { count: 0, installs: 0 };
      cur.count += 1;
      cur.installs += num(e?.installs);
      m.set(t, cur);
    }
    typeBuckets = [...m.entries()].map(([type, v]) => ({ type, count: v.count, installs: v.installs }));
  } else {
    typeBuckets = [];
  }
  typeBuckets.sort((a, b) => b.count - a.count || b.installs - a.installs);

  const analyticsActive =
    analytics !== null &&
    (num(analytics.totalPackages) > 0 || analyticsByType.length > 0 || num(analytics.totalInstalls) > 0);
  const hasMetering =
    metering !== null &&
    (isFiniteNumber(metering.monthlySpend) ||
      isFiniteNumber(metering.requests30d) ||
      isFiniteNumber(metering.aiCostUsd));

  /* ── STAT: listings (noting how many are "(Example)" seeds vs earned) ── */
  const totalListings = hasListings ? listings.length : num(analytics?.totalPackages);
  if (totalListings > 0) {
    stats.push({
      icon: 'store',
      label: 'Marketplace listings',
      value: count(totalListings),
      tone: hasListings && earnedCount > 0 ? 'blue' : 'gray',
      hint: hasListings
        ? exampleCount > 0
          ? `${count(exampleCount)} "(Example)" seed${exampleCount === 1 ? '' : 's'} · ${count(earnedCount)} earned`
          : `${count(earnedCount)} earned`
        : undefined,
    });
  }

  /* ── STAT: by-type (distinct package types represented) ── */
  if (typeBuckets.length > 0) {
    stats.push({
      icon: 'layers',
      label: 'Package types',
      value: count(typeBuckets.length),
      tone: 'blue',
      hint: `top: ${humanizeType(typeBuckets[0].type)}`,
    });
  }

  /* ── STAT: revenue (honest zero — the commercial metering ledger, never listing prices) ── */
  if (hasMetering) {
    const spend = num(metering?.monthlySpend);
    const currency = str(metering?.currency) || 'USD';
    stats.push({
      icon: 'tag',
      label: 'Revenue (metered)',
      value: money(spend, currency),
      tone: spend > 0 ? 'green' : 'gray',
      hint: spend > 0 ? `${count(num(metering?.requests30d))} req · 30d` : 'commercial ledger · zero until real',
    });
  }

  /* ── STAT: adoption (installed / catalog, real-computed) ── */
  if (analyticsActive && isFiniteNumber(analytics?.adoption)) {
    const adoption = num(analytics?.adoption);
    stats.push({
      icon: 'gauge',
      label: 'Adoption',
      value: pctText(adoption),
      tone: healthTone(adoption),
      hint: 'installed / catalog',
    });
  }

  /* ── GROUP: Listings & trust (references the REAL submission pipeline) ── */
  if (hasListings) {
    const signed = listings.filter((e) => e?.signed === true).length;
    const certified = listings.filter((e) => e?.certified === true).length;
    const distinctPublishers = new Set(
      listings.map((e) => str(e?.publisher?.id)).filter((x) => x.length > 0),
    ).size;
    const publisherCount = isFiniteNumber(analytics?.totalPublishers)
      ? num(analytics?.totalPublishers)
      : distinctPublishers;

    const rows: OpRow[] = [
      {
        label: 'Total listings',
        value: count(listings.length),
        sub:
          exampleCount > 0
            ? `${count(exampleCount)} "(Example)" seed${exampleCount === 1 ? '' : 's'}`
            : 'no example seeds',
      },
      {
        label: 'Earned (non-example)',
        value: count(earnedCount),
        tone: earnedCount > 0 ? 'green' : 'gray',
        sub: earnedCount > 0 ? undefined : 'catalog is seed examples only today',
      },
      {
        label: 'Signed (Ed25519)',
        value: count(signed),
        tone: signed > 0 ? 'green' : 'gray',
        sub: 'manifest digest signed at publish',
      },
      { label: 'Certified', value: count(certified), tone: certified > 0 ? 'green' : 'gray' },
      { label: 'Publishers', value: count(publisherCount), sub: 'single self-publisher today' },
    ];
    groups.push({
      title: 'Listings & trust',
      rows,
      note: 'Real submission pipeline: static security scan → Ed25519 manifest signing → review → publish → rollback (ecosystem/marketplace/pipeline.ts). Seed listings are auto-approved "(Example)" packages and the submitter self-reviews — no separation of duties yet.',
    });
  }

  /* ── GROUP: Analytics (real-computed) — with the two honest caveats + metering ── */
  if (analyticsActive || hasMetering) {
    const rows: OpRow[] = [];
    if (analyticsActive) {
      rows.push({ label: 'Total installs', value: count(num(analytics?.totalInstalls)) });
      if (isFiniteNumber(analytics?.adoption)) {
        rows.push({
          label: 'Adoption',
          value: pctText(num(analytics?.adoption)),
          tone: healthTone(num(analytics?.adoption)),
          sub: 'installed / catalog',
        });
      }
      rows.push({
        label: 'Updates available',
        value: count(num(analytics?.updatesAvailable)),
        tone: num(analytics?.updatesAvailable) > 0 ? 'orange' : 'gray',
      });

      const byChannel = arr(analytics?.byChannel).filter((c) => num(c?.count) > 0);
      if (byChannel.length > 0) {
        rows.push({
          label: 'Release channels',
          value: byChannel.map((c) => `${str(c?.channel) || '—'} (${count(num(c?.count))})`).join(', '),
          tone: 'gray',
          sub: 'byChannel collapses to "stable" — no channel field on versions',
        });
      }

      rows.push({
        label: 'Rollback rate',
        value: pctText(num(analytics?.rollbackRate)),
        tone: 'gray',
        sub: 'stubbed 0 — no rollback telemetry yet',
      });

      if (typeBuckets.length > 0) {
        const top = typeBuckets[0];
        rows.push({
          label: `Top type · ${humanizeType(top.type)}`,
          value: count(top.count),
          sub: `${count(top.installs)} install${top.installs === 1 ? '' : 's'}`,
        });
      }
    }

    if (hasMetering) {
      const spend = num(metering?.monthlySpend);
      const currency = str(metering?.currency) || 'USD';
      rows.push({
        label: 'Revenue (monthly, metered)',
        value: money(spend, currency),
        tone: spend > 0 ? 'green' : 'gray',
        sub: 'commercial metering ledger · zero until real',
      });
      rows.push({
        label: 'Requests (30d)',
        value: count(num(metering?.requests30d)),
        sub: 'commercial metering ledger',
      });
      if (isFiniteNumber(metering?.aiCostUsd)) {
        rows.push({
          label: 'AI cost (metered)',
          value: money(num(metering?.aiCostUsd), 'USD'),
          tone: 'gray',
          sub: 'commercial metering ledger',
        });
      }
    }

    groups.push({
      title: 'Analytics (real-computed)',
      rows,
      note: 'Marketplace analytics are real-computed with two caveats: byChannel collapses to "stable" (no channel field on versions) and rollbackRate is stubbed 0 (no rollback telemetry). Revenue is the commercial metering ledger — an honest zero until real usage is billed; marketplace listings do not transact.',
    });
  }

  return { stats, groups, gaps: marketplaceGaps(), links: marketplaceLinks() };
}
