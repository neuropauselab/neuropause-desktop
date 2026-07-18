/**
 * Platform Governance — pure presentation lens for the Platform Ecosystem workspace
 * (Phase 5, Sub-Agent 7). This tab governs the ECOSYSTEM itself: the marketplace,
 * extensions/packages, agents, and partners. It COMPOSES governance signals that
 * already ship — it adds no engine, IPC channel, store, or service. Every stat/row
 * below is derived from a REAL field returned by an EXISTING `ipc.*` read:
 *
 *   - ipc.marketplace.policy()          -> OrgMarketplacePolicy   the editable org
 *                                          marketplace policy (requireApproval /
 *                                          requireSignature / minPublisherTier /
 *                                          blockedTypes / blocked+allowed publishers)
 *   - ipc.workforce.policies()          -> PolicyRule[]           agent-action rules
 *                                          (effect / enabled / minTrust)
 *   - ipc.enterprise.governanceConfig() -> GovernanceConfig       approval chains +
 *                                          compliance rules (count / enabled)
 *   - ipc.workforce.workers()           -> WorkerSummary[]        earned `trustScore`
 *   - ipc.marketplace.publishers()      -> PublisherProfile[]     aggregate publisher trust
 *   - ipc.marketplace.catalog()         -> MarketplaceEntry[]     aggregate package trust
 *
 * Capabilities the platform does NOT genuinely have are surfaced as honest `OpGap`s
 * ("Requires …"), never as invented numbers. All three are architectural absences,
 * so they are always present regardless of how much real data is loaded:
 *   - a third-party re-certification workflow (`certified` is write-once at listing
 *     creation — there is no certify mutator or reviewer),
 *   - a dedicated extension policy engine (extensions reuse the marketplace org
 *     policy + per-plugin permission grants — there is no plugin policy engine),
 *   - partner / SDK trust scoring (partner records carry no trust score and the
 *     partner directory is demo-only).
 *
 * Authenticity guard: a worker's `trustScore` is EARNED RELIABILITY that evolves per
 * job; publisher/package trust are AGGREGATE trust scores from the marketplace Trust
 * Center. Neither is ever labeled a "safety" or "certification" guarantee.
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
// Type-only (erased at runtime): the REAL shared contracts. Used by
// `toGovernanceInput` to statically bind the ipc.* return types to the structural
// input below — if any shared contract drifts, that binding stops compiling under
// the same tsc gate as the rest of the renderer.
import type {
  OrgMarketplacePolicy,
  PolicyRule,
  GovernanceConfig,
  WorkerSummary,
  PublisherProfile,
  MarketplaceEntry,
} from '@neuropause/shared';

/* ── Structural input (minimal, defensively optional) ──────────────────────────
 * Each shape is a documented, widened mirror of the shared type it maps from.
 * Every field is optional so a partially-loaded, empty, or malformed payload
 * degrades to an honest empty state instead of throwing or fabricating.
 */

/** Org marketplace governance policy — mirrors `OrgMarketplacePolicy` (ipc.marketplace.policy()). */
export interface GovMarketplacePolicyInput {
  /** Every install requires an approval before it may proceed. */
  requireApproval?: boolean;
  /** An unsigned package cannot be installed. */
  requireSignature?: boolean;
  /** Minimum publisher tier a package must meet — 'unverified'|'verified'|'trusted'|'official'. */
  minPublisherTier?: string;
  /** Package types that may not be installed. */
  blockedTypes?: readonly string[];
  blockedPublishers?: readonly string[];
  /** If non-empty, ONLY these publisher ids are allowed (an allowlist). */
  allowedPublishers?: readonly string[];
}

/** An agent-action governance rule — mirrors `PolicyRule` (ipc.workforce.policies()). */
export interface GovPolicyRuleInput {
  id?: string;
  title?: string;
  /** 'allow' | 'deny' | 'require_approval' */
  effect?: string;
  enabled?: boolean;
  /** Trust gate: a worker's trust must be ≥ this for the rule to be satisfied. */
  minTrust?: number;
}

/** An enterprise approval chain — mirrors `ApprovalChain` within `GovernanceConfig`. */
export interface GovApprovalChainInput {
  id?: string;
  name?: string;
  enabled?: boolean;
}

/** A compliance rule — mirrors `ComplianceRule` within `GovernanceConfig`. */
export interface GovComplianceRuleInput {
  id?: string;
  name?: string;
  enabled?: boolean;
}

/** Editable enterprise governance config — mirrors `GovernanceConfig` (ipc.enterprise.governanceConfig()). */
export interface GovConfigInput {
  approvalChains?: readonly GovApprovalChainInput[];
  complianceRules?: readonly GovComplianceRuleInput[];
}

/** A publisher trust record — mirrors `PublisherProfile` (ipc.marketplace.publishers()). */
export interface GovPublisherInput {
  id?: string;
  name?: string;
  /** 'unverified' | 'verified' | 'trusted' | 'official' */
  tier?: string;
  /** 0..1 aggregate publisher trust. */
  trustScore?: number;
}

/** A catalog package's trust signals — mirrors `MarketplaceEntry` (ipc.marketplace.catalog()). */
export interface GovPackageInput {
  id?: string;
  /** 0..1 aggregate package trust. */
  trustScore?: number;
  /** Write-once at listing creation (no re-certification workflow — see gaps). */
  certified?: boolean;
  signed?: boolean;
}

/** A worker's compact view — mirrors `WorkerSummary` (ipc.workforce.workers()). */
export interface GovWorkerInput {
  name?: string;
  /** Earned reliability in 0..1. NOT a safety or certification score. */
  trustScore?: number;
}

/** The complete, defensively-optional input this lens derives from. */
export interface GovernanceInput {
  /** ipc.marketplace.policy() — a singleton config object (present even when permissive). */
  marketplacePolicy?: GovMarketplacePolicyInput | null;
  /** ipc.workforce.policies() — agent-action rules. */
  workforcePolicies?: readonly GovPolicyRuleInput[];
  /** ipc.enterprise.governanceConfig() — approval chains + compliance rules. */
  governance?: GovConfigInput | null;
  /** ipc.workforce.workers() — worker trust rows. */
  workers?: readonly GovWorkerInput[];
  /** ipc.marketplace.publishers() — publisher trust rows. */
  publishers?: readonly GovPublisherInput[];
  /** ipc.marketplace.catalog() — package trust rows. */
  packages?: readonly GovPackageInput[];
}

/**
 * Bind the REAL shared contracts to the structural input. A caller feeds `ipc.*`
 * results straight through this seam; it also statically proves the structural
 * mirrors above stay consistent with the shared types — the assignments stop
 * compiling if `OrgMarketplacePolicy`, `PolicyRule`, `GovernanceConfig`,
 * `WorkerSummary`, `PublisherProfile`, or `MarketplaceEntry` drift out of shape.
 */
export function toGovernanceInput(src: {
  marketplacePolicy?: OrgMarketplacePolicy | null;
  workforcePolicies?: readonly PolicyRule[] | null;
  governance?: GovernanceConfig | null;
  workers?: readonly WorkerSummary[] | null;
  publishers?: readonly PublisherProfile[] | null;
  packages?: readonly MarketplaceEntry[] | null;
}): GovernanceInput {
  return {
    marketplacePolicy: src.marketplacePolicy ?? undefined,
    workforcePolicies: src.workforcePolicies ?? undefined,
    governance: src.governance ?? undefined,
    workers: src.workers ?? undefined,
    publishers: src.publishers ?? undefined,
    packages: src.packages ?? undefined,
  };
}

/* ── Thresholds (presentation only; the counts they gate are all real) ── */

/** Trust floor: below this, earned trust is a genuine risk-threshold breach. */
const TRUST_FLOOR = 0.5;

/** Publisher verification tiers, ranked weakest → strongest. */
const TIER_RANK: Readonly<Record<string, number>> = {
  unverified: 0,
  verified: 1,
  trusted: 2,
  official: 3,
};

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
function cap(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
function tierRank(t: string | undefined): number {
  return TIER_RANK[t ?? ''] ?? 0;
}
/** Tone for a required tier gate: higher tier requirement = stronger governance. */
function tierTone(t: string | undefined): OpsTone {
  const r = tierRank(t);
  return r >= 2 ? 'green' : r === 1 ? 'orange' : 'gray';
}
function mean(xs: readonly number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/**
 * Honest capability gaps. Each is a genuine architectural absence in today's
 * ecosystem governance (recon-verified), so all three are surfaced regardless of
 * how much real data exists. None hides an available value.
 */
const GOVERNANCE_GAPS: readonly OpGap[] = [
  {
    capability: 'Third-party certification workflow',
    requires:
      'a certify mutator + reviewer — "certified" is set once at listing creation, with no re-certification workflow',
  },
  {
    capability: 'Extension-specific policy engine',
    requires:
      'a plugin policy engine — extensions are governed today by reused marketplace org-policy + per-plugin permission grants, not a dedicated engine',
  },
  {
    capability: 'Partner / SDK trust scoring',
    requires: 'partner records — none exist (partner directory is demo-only)',
  },
];

/** Deep-links to the canonical existing surfaces (reuse, never duplicate). */
const GOVERNANCE_LINKS: readonly OpLink[] = [
  { label: 'Administration', section: 'administration', icon: 'shield' },
  { label: 'Marketplace governance', section: 'marketplace', icon: 'store' },
];

/**
 * Derive the view-ready Platform Governance lens. Only signals that are genuinely
 * present produce stats/rows; an absent or empty signal shows the honest empty
 * state (nothing) rather than a placeholder. The marketplace policy is a singleton
 * config object, so a PRESENT-but-permissive policy still renders (its "not
 * required" posture is a real governance fact, not an absence). Gaps and links are
 * always emitted.
 */
export function summarizeGovernance(input: GovernanceInput): OpLens {
  const stats: OpStat[] = [];
  const groups: OpGroup[] = [];
  const policyRows: OpRow[] = [];

  // ── Marketplace org policy (real) ── ipc.marketplace.policy()
  const mp = input.marketplacePolicy;
  if (mp) {
    const approval = mp.requireApproval === true;
    const signature = mp.requireSignature === true;
    const blockedTypes = list(mp.blockedTypes);
    const blockedPublishers = list(mp.blockedPublishers);
    const allowedPublishers = list(mp.allowedPublishers);

    // Posture = the two install-BLOCKING gates. Active controls also count the
    // softer restrictions (tier gate, type/publisher blocks, allowlist).
    const hardGates = (approval ? 1 : 0) + (signature ? 1 : 0);
    const activeControls =
      hardGates +
      (tierRank(mp.minPublisherTier) > 0 ? 1 : 0) +
      (blockedTypes.length > 0 ? 1 : 0) +
      (blockedPublishers.length > 0 ? 1 : 0) +
      (allowedPublishers.length > 0 ? 1 : 0);
    const postureTone: OpsTone = hardGates === 2 ? 'green' : hardGates === 1 ? 'orange' : 'red';
    const gateBits: string[] = [];
    if (approval) gateBits.push('approval');
    if (signature) gateBits.push('signature');

    stats.push({
      icon: 'shield',
      label: 'Marketplace policy',
      value: count(activeControls),
      tone: postureTone,
      hint: gateBits.length > 0 ? `${gateBits.join(' + ')} required` : 'no install gate enforced',
    });

    policyRows.push(
      { label: 'Install approval', value: approval ? 'Required' : 'Not required', tone: approval ? 'green' : 'gray' },
      { label: 'Package signature', value: signature ? 'Required' : 'Not required', tone: signature ? 'green' : 'gray' },
      {
        label: 'Min publisher tier',
        value: cap(mp.minPublisherTier ?? 'unverified'),
        tone: tierTone(mp.minPublisherTier),
      },
      {
        label: 'Blocked package types',
        value: count(blockedTypes.length),
        tone: blockedTypes.length > 0 ? 'orange' : 'gray',
        ...(blockedTypes.length > 0 ? { sub: blockedTypes.join(', ') } : {}),
      },
      {
        label: 'Blocked publishers',
        value: count(blockedPublishers.length),
        tone: blockedPublishers.length > 0 ? 'orange' : 'gray',
      },
      {
        label: 'Publisher allowlist',
        value: allowedPublishers.length > 0 ? `${count(allowedPublishers.length)} allowed` : 'Open',
        tone: allowedPublishers.length > 0 ? 'green' : 'gray',
      },
    );
  }

  // ── Workforce agent policies (real) ── ipc.workforce.policies()
  const policies = list(input.workforcePolicies);
  if (policies.length > 0) {
    const total = policies.length;
    const enabled = policies.filter((p) => p.enabled === true).length;
    const deny = policies.filter((p) => p.effect === 'deny').length;
    const approvals = policies.filter((p) => p.effect === 'require_approval').length;
    const enabledRatio = enabled / total;

    stats.push({
      icon: 'checklist',
      label: 'Agent policies',
      value: count(total),
      tone: healthTone(enabledRatio),
      hint: `${count(enabled)} enabled`,
    });

    policyRows.push(
      {
        label: 'Agent policies',
        value: `${count(enabled)} of ${count(total)}`,
        tone: healthTone(enabledRatio),
        sub: `${pctText(enabledRatio)} enabled`,
      },
      { label: 'Deny rules', value: count(deny) },
      { label: 'Require approval', value: count(approvals) },
    );
  }

  // ── Enterprise approval chains + compliance rules (real) ── ipc.enterprise.governanceConfig()
  const gov = input.governance;
  const chains = list(gov?.approvalChains);
  const rules = list(gov?.complianceRules);
  if (chains.length > 0) {
    const enabledChains = chains.filter((c) => c.enabled === true).length;
    stats.push({
      icon: 'layers',
      label: 'Approval chains',
      value: count(chains.length),
      tone: healthTone(enabledChains / chains.length),
      hint: `${count(enabledChains)} enabled`,
    });
    policyRows.push({
      label: 'Approval chains',
      value: `${count(enabledChains)} of ${count(chains.length)}`,
      tone: healthTone(enabledChains / chains.length),
    });
  }
  if (rules.length > 0) {
    const enabledRules = rules.filter((r) => r.enabled === true).length;
    policyRows.push({
      label: 'Compliance rules',
      value: `${count(enabledRules)} of ${count(rules.length)}`,
      tone: healthTone(enabledRules / rules.length),
    });
  }

  if (policyRows.length > 0) {
    groups.push({
      title: 'Ecosystem policy (real)',
      rows: policyRows,
      note: 'Real org marketplace policy, agent-action policies, and enterprise approval chains — presented, not added.',
    });
  }

  // ── Trust (real) ── publisher / package / worker trust, referenced as rows.
  const trustRows: OpRow[] = [];

  const publishers = list(input.publishers);
  if (publishers.length > 0) {
    const trusts = publishers.map((p) => p.trustScore).filter(isFiniteNum);
    const topTier = publishers.filter((p) => tierRank(p.tier) >= 2).length;
    trustRows.push({ label: 'Publishers', value: count(publishers.length) });
    if (trusts.length > 0) {
      const m = mean(trusts);
      trustRows.push({ label: 'Mean publisher trust', value: score(m), tone: healthTone(m) });
    }
    trustRows.push({
      label: 'Official / trusted tier',
      value: `${count(topTier)} of ${count(publishers.length)}`,
    });
  }

  const packages = list(input.packages);
  if (packages.length > 0) {
    const trusts = packages.map((k) => k.trustScore).filter(isFiniteNum);
    const certified = packages.filter((k) => k.certified === true).length;
    const signed = packages.filter((k) => k.signed === true).length;
    trustRows.push({ label: 'Catalog packages', value: count(packages.length) });
    if (trusts.length > 0) {
      const m = mean(trusts);
      trustRows.push({ label: 'Mean package trust', value: score(m), tone: healthTone(m) });
    }
    trustRows.push(
      {
        label: 'Certified',
        value: `${count(certified)} of ${count(packages.length)}`,
        tone: healthTone(certified / packages.length),
      },
      {
        label: 'Signed',
        value: `${count(signed)} of ${count(packages.length)}`,
        tone: healthTone(signed / packages.length),
      },
    );
  }

  const workers = list(input.workers);
  if (workers.length > 0) {
    const trusts = workers.map((w) => w.trustScore).filter(isFiniteNum);
    trustRows.push({ label: 'Workers', value: count(workers.length) });
    if (trusts.length > 0) {
      const m = mean(trusts);
      const below = trusts.filter((t) => t < TRUST_FLOOR).length;
      trustRows.push(
        {
          label: 'Mean worker trust',
          value: score(m),
          tone: healthTone(m),
          sub: 'earned reliability, evolves per job',
        },
        {
          label: 'Below trust floor',
          value: count(below),
          tone: riskTone(below / trusts.length),
          sub: `trust < ${score(TRUST_FLOOR)}`,
        },
      );
    }
  }

  if (trustRows.length > 0) {
    groups.push({
      title: 'Trust (real)',
      rows: trustRows,
      note: 'Publisher and package trust are aggregate Trust Center scores; worker trust is earned reliability. Read-only here. Catalog packages include the marketplace example listings.',
    });
  }

  return { stats, groups, gaps: [...GOVERNANCE_GAPS], links: [...GOVERNANCE_LINKS] };
}
