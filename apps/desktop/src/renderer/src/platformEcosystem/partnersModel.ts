/**
 * Platform Ecosystem (Phase 5) — Partner Platform tab-lens (Sub-Agent 4).
 *
 * This tab is DELIBERATELY gap-heavy. NeuroPause ships no partner-records product.
 * The only "partner directory" (`ipc.ecosystem.partners()` / `partnersStats()` and
 * the `partners` field of `ipc.ecosystem.analytics()`) is a hard-coded demo FIXTURE
 * (`PartnersStore` seed) that is gated OFF in production behind `NP_DEMO_SEEDS`. With
 * demo seeds disabled — the production default — the directory is EMPTY, so every
 * partner tier, certification, listing count, and analytics number would be fabricated.
 *
 * The lens therefore does the honest thing. It reports the directory's REAL count
 * (0 in production) and presents a THIN reference over the genuinely-shipped ADJACENT
 * primitives a partner actually builds on:
 *   - the read-only deployment-mode catalog (`ipc.commercial.deployment()`, a 5-mode
 *     reference: cloud_saas / private_cloud / hybrid / on_premises / air_gapped),
 *   - the developer OAuth apps a partner registers to integrate (`ipc.ecosystem.oauthApps()`),
 *   - the developer/API tier it integrates under (`ipc.ecosystem.account()`), and
 *   - the real `'partner'` federation exchange scope
 *     (ExchangeScope = 'private' | 'public' | 'partner' | 'regional').
 *
 * Everything the platform does NOT genuinely have — a solution/SI/reseller partner
 * model, partner certification, partner analytics, partner-scoped deployment profiles —
 * is surfaced as a labeled `OpGap` stating the real architecture it would require,
 * never as an invented value.
 *
 * Pure derivation: no ipc, no main-process access, no fabrication.
 */
import { type OpLens, count } from '@renderer/aiOperations/aiOperationsModel';

/** One entry of the read-only deployment-mode catalog (ipc.commercial.deployment().modes). */
export interface DeploymentModeLike {
  id?: string;
  name?: string;
  available?: boolean;
  current?: boolean;
}

/**
 * Minimal, structural, defensively-optional input. The coordinator maps real `ipc`
 * payloads onto these shapes; every field is optional so an unavailable signal
 * degrades to an honest empty state rather than throwing or fabricating.
 */
export interface PartnersInput {
  /**
   * ipc.commercial.deployment() -> CommercialDeployment. The real read-only
   * deployment-mode catalog (5 synthesized modes) a partner references. It has no
   * partner scoping of its own.
   */
  deployment?: {
    modes?: readonly DeploymentModeLike[] | null;
    currentMode?: string | null;
  } | null;
  /**
   * ipc.ecosystem.partners() -> Partner[] (or its length). The Partner directory is a
   * DEMO fixture gated OFF in production — EMPTY in a real install. Pass the real list
   * or its real count; this lens NEVER seeds a number of its own.
   */
  partnerDirectory?: readonly unknown[] | number | null;
  /**
   * ipc.ecosystem.oauthApps() -> OAuthApplication[] (or its length). Developer OAuth
   * apps registered to integrate against the platform APIs — a real integration primitive.
   */
  oauthApps?: readonly unknown[] | number | null;
  /**
   * ipc.ecosystem.account() -> DeveloperAccount.planTier. The developer/API tier a
   * partner integrates under (reference only — this is not a partner-program tier).
   */
  apiPartnerTier?: string | null;
  /**
   * Whether the real `'partner'` federation exchange scope is reachable. Reference
   * only; the scope literal genuinely exists regardless.
   */
  federationPartnerScope?: boolean | null;
}

/** Count from an array or a pre-counted number; anything else (incl. undefined) is an honest 0. */
function sizeOf(v: readonly unknown[] | number | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
  return Array.isArray(v) ? v.length : 0;
}

/**
 * Derive the Partner Platform lens. The only production-authentic content is the
 * honest directory count (0), a thin reference over real adjacent primitives, and
 * the honest gaps standing in for a partner-records product that does not exist.
 */
export function summarizePartners(input: PartnersInput = {}): OpLens {
  const deployment = input.deployment ?? undefined;
  const modes = deployment?.modes ?? [];
  const totalModes = modes.length;
  const availableModes = modes.filter((m) => m?.available !== false).length;
  const rawCurrent = deployment?.currentMode;
  const currentMode =
    (typeof rawCurrent === 'string' && rawCurrent) || modes.find((m) => m?.current)?.id || undefined;
  const modeNames = modes
    .map((m) => m?.name ?? m?.id)
    .filter((n): n is string => typeof n === 'string');

  const partnerCount = sizeOf(input.partnerDirectory);
  const oauthCount = sizeOf(input.oauthApps);
  const apiTier =
    typeof input.apiPartnerTier === 'string' && input.apiPartnerTier ? input.apiPartnerTier : undefined;

  // ── Headline stats: all backed by real source values; the partner count is honest (0 in prod). ──
  const stats: OpLens['stats'] = [
    {
      icon: 'layers',
      label: 'Deployment modes',
      value: count(totalModes),
      tone: totalModes > 0 ? 'blue' : 'gray',
      hint: totalModes > 0 ? `${count(availableModes)} available · read-only catalog` : 'catalog not loaded',
    },
    {
      icon: 'globe',
      label: 'Partner directory entries',
      value: count(partnerCount),
      tone: partnerCount > 0 ? 'orange' : 'gray',
      hint: partnerCount > 0 ? 'demo fixtures (NP_DEMO_SEEDS)' : 'empty in production — directory is demo-gated',
    },
    {
      icon: 'code',
      label: 'Developer OAuth apps',
      value: count(oauthCount),
      tone: oauthCount > 0 ? 'blue' : 'gray',
      hint: 'apps a partner registers to integrate (real primitive)',
    },
  ];

  // ── The genuinely-shipped substrate a partner builds on (reference over real primitives). ──
  const substrateRows: OpLens['groups'][number]['rows'] = [
    {
      label: 'Deployment mode catalog',
      value: totalModes > 0 ? `${count(availableModes)}/${count(totalModes)} available` : 'unavailable',
      tone: totalModes > 0 ? 'blue' : 'gray',
      sub: modeNames.length ? modeNames.join(' · ') : 'ipc.commercial.deployment() (read-only)',
    },
  ];
  if (currentMode) substrateRows.push({ label: 'Current deployment mode', value: currentMode });
  substrateRows.push({
    label: 'Developer OAuth apps',
    value: count(oauthCount),
    sub: 'ipc.ecosystem.oauthApps() — registered API integrations',
  });
  if (apiTier) {
    substrateRows.push({
      label: 'API partner tier',
      value: apiTier,
      tone: 'blue',
      sub: 'developer/API tier (reference — not a partner-program tier)',
    });
  }
  substrateRows.push({
    label: 'Federation partner scope',
    value: input.federationPartnerScope === false ? 'unreachable' : "'partner' exchange scope",
    tone: input.federationPartnerScope === false ? 'gray' : 'blue',
    sub: "shared resources can be scoped to partner orgs (real federation primitive)",
  });

  const groups: OpLens['groups'] = [
    {
      title: 'Real integration substrate (what a partner builds on)',
      note: 'The only production-authentic partner surface is this thin reference over already-shipped primitives. None of these is a partner program — a partner has no tier, certification, or analytics of its own here (see gaps).',
      rows: substrateRows,
    },
    {
      title: 'Partner directory (demo fixture)',
      note: 'The partner directory is seeded only when NP_DEMO_SEEDS=1. In a production install it is EMPTY — no partner records, tiers, certifications, or partner analytics are real. Real entries require a partner-records backend.',
      rows: [
        {
          label: 'Directory entries',
          value: count(partnerCount),
          tone: partnerCount > 0 ? 'orange' : 'gray',
          sub: partnerCount > 0 ? 'demo fixtures present — not production data' : 'empty in production',
        },
      ],
    },
  ];

  // ── Honest gaps: each is a genuine absence, stated as the real architecture it needs. ──
  const gaps: OpLens['gaps'] = [
    {
      capability: 'Solution partner / SI / reseller model',
      requires: 'a real partner-records backend — the directory is a demo fixture, empty in production',
    },
    {
      capability: 'Partner certification',
      requires: 'partner records first — none exist; Partner.certified is fixture data',
    },
    {
      capability: 'Partner analytics',
      requires: 'real partner records — empty in production',
    },
    {
      capability: 'Partner deployment profiles',
      requires: 'partner-scoped profiles — only a synthesized deployment-mode catalog exists',
    },
  ];

  // ── Reuse deep-links to the canonical surfaces (never duplicated here). ──
  const links: OpLens['links'] = [
    { label: 'Ecosystem · Partners', section: 'ecosystem', icon: 'globe' },
    { label: 'Federation', section: 'federation', icon: 'layers' },
  ];

  return { stats, groups, gaps, links };
}
