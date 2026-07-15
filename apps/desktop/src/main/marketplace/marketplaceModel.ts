/**
 * P9 — Enterprise Marketplace: the pure intelligence model.
 *
 * All non-trivial marketplace logic lives here (the house pure-model pattern) so it is
 * unit-tested under Node. It computes over the marketplace-layer VMs projected from the
 * EXISTING ecosystem listings + P8.5 install state — package taxonomy, publisher/package
 * trust, release channels, semver compatibility (reuses `satisfiesRange`), dependency
 * install plans (reuses `planGoal` — no new resolver), discovery/ranking/filter/collections,
 * the Trust Center report, org governance verdicts, and analytics. No I/O; no new package
 * format, PKI, search, or governance engine.
 */
import type {
  InstallCapability,
  InstallPlan,
  InstallState,
  ListingKind,
  MarketplaceAnalytics,
  MarketplaceCatalogQuery,
  MarketplaceDecision,
  MarketplaceEntry,
  MarketplacePackageType,
  MarketplaceSort,
  MarketplaceVerdict,
  OrgMarketplacePolicy,
  PublisherTier,
  ReleaseChannel,
  TrustReport,
} from '@neuropause/shared';
import { MARKETPLACE_PACKAGE_TYPES, RELEASE_CHANNELS } from '@neuropause/shared';
import { satisfiesRange } from '../plugins/manifest';
import { planGoal } from '../workforce/planning/goalPlanner';

/* ── taxonomy ────────────────────────────────────────────────────────────── */

const KIND_TO_TYPE: Record<string, MarketplacePackageType> = {
  ai_worker: 'worker',
  connector: 'connector',
  plugin: 'template',
  automation_template: 'automation_pack',
  enterprise_template: 'blueprint',
  ai_app: 'template',
};

/** Map an ecosystem `ListingKind` (+ optional explicit metadata) to a package type. */
export function packageTypeFor(kind: ListingKind, metadata: Record<string, string> = {}): MarketplacePackageType {
  const explicit = metadata.packageType as MarketplacePackageType | undefined;
  if (explicit && MARKETPLACE_PACKAGE_TYPES.includes(explicit)) return explicit;
  return KIND_TO_TYPE[kind] ?? 'template';
}

/** How a package type is adopted today (recon-verified installer availability). */
export function capabilityFor(type: MarketplacePackageType): InstallCapability {
  if (type === 'worker') return 'installable';
  if (type === 'connector') return 'connect';
  if (type === 'automation_pack' || type === 'policy_pack') return 'import';
  return 'catalog';
}

export function channelFor(metadata: Record<string, string> = {}): ReleaseChannel {
  const c = metadata.channel as ReleaseChannel | undefined;
  return c && RELEASE_CHANNELS.includes(c) ? c : 'stable';
}

/* ── trust ───────────────────────────────────────────────────────────────── */

const TIER_RANK: Record<PublisherTier, number> = { unverified: 0, verified: 1, trusted: 2, official: 3 };
export function tierRank(t: PublisherTier): number {
  return TIER_RANK[t];
}

export interface PublisherSignals {
  verified: boolean;
  official: boolean;
  installs: number;
  keyId: string | null;
}

export function publisherTier(p: PublisherSignals): PublisherTier {
  if (p.official) return 'official';
  if (p.verified) return p.installs >= 1000 ? 'trusted' : 'verified';
  return 'unverified';
}

/** Aggregate publisher trust, 0..1. */
export function publisherTrust(p: PublisherSignals): number {
  const base: Record<PublisherTier, number> = { unverified: 0.2, verified: 0.6, trusted: 0.8, official: 0.95 };
  const signed = p.keyId ? 0.05 : 0;
  return Math.max(0, Math.min(1, base[publisherTier(p)] + signed));
}

/** Aggregate package trust, blending signature/certification/scan with publisher trust, 0..1. */
export function packageTrust(input: {
  signed: boolean;
  certified: boolean;
  scan: 'pass' | 'warn' | 'fail' | 'none';
  publisherTrust: number;
}): number {
  let pkg = 0.25;
  if (input.signed) pkg += 0.35;
  if (input.certified) pkg += 0.2;
  if (input.scan === 'pass') pkg += 0.1;
  if (input.scan === 'fail') pkg -= 0.3;
  pkg = Math.max(0, Math.min(1, pkg));
  return Math.max(0, Math.min(1, pkg * 0.55 + input.publisherTrust * 0.45));
}

/* ── catalog entry composition ───────────────────────────────────────────── */

export interface PublisherInput {
  id: string;
  name: string;
  verified: boolean;
  official: boolean;
  listings: number;
  installs: number;
  keyId: string | null;
  verifiedAt: string | null;
}

export interface EntryInput {
  id: string;
  slug: string;
  name: string;
  summary: string;
  kind: ListingKind;
  metadata: Record<string, string>;
  category: string;
  certified: boolean;
  version: string;
  signed: boolean;
  scan: 'pass' | 'warn' | 'fail' | 'none';
  rating: number;
  ratingCount: number;
  installs: number;
  dependencies: string[];
  updatedAt: string;
  publisher: PublisherInput;
  installStatus: InstallState;
}

/** Project a listing (+ publisher + install state) into a unified catalog entry. */
export function toEntry(i: EntryInput): MarketplaceEntry {
  const type = packageTypeFor(i.kind, i.metadata);
  const pubSignals: PublisherSignals = { verified: i.publisher.verified, official: i.publisher.official, installs: i.publisher.installs, keyId: i.publisher.keyId };
  const tier = publisherTier(pubSignals);
  const pubTrust = publisherTrust(pubSignals);
  return {
    id: i.id,
    slug: i.slug,
    name: i.name,
    summary: i.summary,
    packageType: type,
    listingKind: i.kind,
    capability: capabilityFor(type),
    category: i.category,
    publisher: { id: i.publisher.id, name: i.publisher.name, tier, trustScore: pubTrust },
    version: i.version,
    channel: channelFor(i.metadata),
    signed: i.signed,
    certified: i.certified,
    trustScore: packageTrust({ signed: i.signed, certified: i.certified, scan: i.scan, publisherTrust: pubTrust }),
    rating: i.rating,
    ratingCount: i.ratingCount,
    installs: i.installs,
    installState: i.installStatus,
    dependencies: i.dependencies,
    updatedAt: i.updatedAt,
  };
}

/* ── discovery: filter, rank, collections ────────────────────────────────── */

export function rankCatalog(entries: MarketplaceEntry[], sort: MarketplaceSort = 'relevance'): MarketplaceEntry[] {
  const s = [...entries];
  switch (sort) {
    case 'installs':
      return s.sort((a, b) => b.installs - a.installs);
    case 'rating':
      return s.sort((a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount);
    case 'recent':
      return s.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    case 'trust':
      return s.sort((a, b) => b.trustScore - a.trustScore || b.installs - a.installs);
    case 'trending':
      return s.sort((a, b) => trendScore(b) - trendScore(a));
    default:
      return s.sort((a, b) => b.trustScore - a.trustScore || b.installs - a.installs);
  }
}
function trendScore(e: MarketplaceEntry): number {
  return e.installs * 0.6 + e.rating * e.ratingCount * 0.4;
}

export function filterCatalog(entries: MarketplaceEntry[], q: MarketplaceCatalogQuery = {}): MarketplaceEntry[] {
  let out = entries;
  if (q.type) out = out.filter((e) => e.packageType === q.type);
  if (q.category) out = out.filter((e) => e.category === q.category);
  if (q.channel) out = out.filter((e) => e.channel === q.channel);
  if (q.verifiedOnly) out = out.filter((e) => e.publisher.tier !== 'unverified');
  if (q.installedOnly) out = out.filter((e) => e.installState !== 'not_installed');
  if (q.updatesOnly) out = out.filter((e) => e.installState === 'update_available');
  if (q.q) {
    const s = q.q.trim().toLowerCase();
    out = out.filter(
      (e) =>
        e.name.toLowerCase().includes(s) ||
        e.summary.toLowerCase().includes(s) ||
        e.publisher.name.toLowerCase().includes(s) ||
        e.packageType.includes(s) ||
        e.category.toLowerCase().includes(s),
    );
  }
  return rankCatalog(out, q.sort);
}

export interface MarketplaceCollections {
  featured: MarketplaceEntry[];
  trending: MarketplaceEntry[];
  verified: MarketplaceEntry[];
  recommended: MarketplaceEntry[];
  updates: MarketplaceEntry[];
  installed: MarketplaceEntry[];
}

export function collections(entries: MarketplaceEntry[]): MarketplaceCollections {
  return {
    featured: rankCatalog(entries.filter((e) => e.certified || e.publisher.tier === 'official'), 'trust').slice(0, 12),
    trending: rankCatalog(entries, 'trending').slice(0, 12),
    verified: entries.filter((e) => e.publisher.tier !== 'unverified'),
    recommended: rankCatalog(entries.filter((e) => e.installState === 'not_installed'), 'trust').slice(0, 12),
    updates: entries.filter((e) => e.installState === 'update_available'),
    installed: entries.filter((e) => e.installState === 'installed' || e.installState === 'disabled'),
  };
}

export function categories(entries: MarketplaceEntry[]): { category: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.category, (m.get(e.category) ?? 0) + 1);
  return [...m.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}

/* ── compatibility + dependency resolution (reuses satisfiesRange + planGoal) ── */

export function isCompatible(engineRange: string, appVersion: string): boolean {
  return satisfiesRange(appVersion, engineRange || '*');
}

export interface DepNode {
  dependencies: string[];
  compatible: boolean;
}

/**
 * Resolve a package's dependency graph into an install plan: reachable known nodes are
 * topologically ordered into waves (via `planGoal` — reused, no new resolver), unknown
 * deps become `missing`, and incompatible nodes become `conflicts`. Cycles surface as an
 * error. `ok` requires no missing deps, no conflicts, and no cycle.
 */
export function resolveInstallPlan(rootId: string, nodes: Map<string, DepNode>): InstallPlan {
  if (!nodes.has(rootId)) return { ok: false, waves: [], missing: [], conflicts: [], error: 'unknown_package' };
  const missing: string[] = [];
  const conflicts: { id: string; reason: string }[] = [];
  const reachable = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    const node = nodes.get(id);
    if (!node) continue;
    reachable.add(id);
    if (!node.compatible) conflicts.push({ id, reason: 'incompatible with the current app version' });
    for (const dep of node.dependencies) {
      if (!nodes.has(dep)) missing.push(dep);
      else stack.push(dep);
    }
  }
  const missingU = [...new Set(missing)];
  const tasks = [...reachable].map((id) => ({ id, dependsOn: nodes.get(id)!.dependencies.filter((d) => reachable.has(d)) }));
  const plan = planGoal({ id: rootId, tasks });
  if (!plan.ok) return { ok: false, waves: [], missing: missingU, conflicts, error: plan.error };
  return {
    ok: missingU.length === 0 && conflicts.length === 0,
    waves: plan.plan.waves,
    missing: missingU,
    conflicts,
    error: null,
  };
}

/* ── org governance (policy DATA evaluated here; no new governance engine) ── */

export function evaluatePolicy(
  entry: MarketplaceEntry,
  policy: OrgMarketplacePolicy,
  opts: { signatureValid?: boolean } = {},
): MarketplaceVerdict {
  if (policy.blockedPublishers.includes(entry.publisher.id)) {
    return { decision: 'deny', reasons: [`Publisher "${entry.publisher.name}" is blocked by org policy`] };
  }
  if (policy.allowedPublishers.length > 0 && !policy.allowedPublishers.includes(entry.publisher.id)) {
    return { decision: 'deny', reasons: ['Publisher is not on the organization allowlist'] };
  }
  if (policy.blockedTypes.includes(entry.packageType)) {
    return { decision: 'deny', reasons: [`Package type "${entry.packageType}" is blocked by org policy`] };
  }
  // Key on cryptographic VALIDITY when the trust layer supplies it (a present-but-invalid
  // signature is not "signed"); fall back to signature presence otherwise.
  const validlySigned = opts.signatureValid ?? entry.signed;
  if (policy.requireSignature && !validlySigned) {
    return { decision: 'deny', reasons: ['A valid signature is required by org policy'] };
  }
  if (tierRank(entry.publisher.tier) < tierRank(policy.minPublisherTier)) {
    return { decision: 'deny', reasons: [`Publisher tier "${entry.publisher.tier}" is below the required "${policy.minPublisherTier}"`] };
  }
  if (policy.requireApproval) {
    return { decision: 'require_approval', reasons: ['Organization policy requires approval before install'] };
  }
  return { decision: 'allow', reasons: [] };
}

/* ── trust report ────────────────────────────────────────────────────────── */

export function buildTrustReport(
  entry: MarketplaceEntry,
  o: {
    signatureValid: boolean;
    signatureKeyId: string | null;
    scan: 'pass' | 'warn' | 'fail' | 'none';
    compatible: boolean;
    compatibilityNote: string | null;
    verdict: MarketplaceVerdict;
  },
): TrustReport {
  const certificate: TrustReport['certificate'] = !entry.signed ? 'unsigned' : o.signatureValid ? 'valid' : 'untrusted';
  return {
    listingId: entry.id,
    signatureValid: o.signatureValid,
    signatureKeyId: o.signatureKeyId,
    certificate,
    publisherTier: entry.publisher.tier,
    publisherTrust: entry.publisher.trustScore,
    trustScore: entry.trustScore,
    scan: o.scan,
    compatible: o.compatible,
    compatibilityNote: o.compatibilityNote,
    policy: o.verdict,
  };
}

/* ── analytics ───────────────────────────────────────────────────────────── */

export function computeAnalytics(
  entries: MarketplaceEntry[],
  publishers: { id: string; name: string; installs: number; tier: PublisherTier }[],
  rollbacks: number,
): MarketplaceAnalytics {
  const totalInstalls = entries.reduce((n, e) => n + e.installs, 0);
  const installed = entries.filter((e) => e.installState !== 'not_installed');
  const updates = entries.filter((e) => e.installState === 'update_available').length;
  const byType = MARKETPLACE_PACKAGE_TYPES.map((type) => {
    const es = entries.filter((e) => e.packageType === type);
    return { type, count: es.length, installs: es.reduce((n, e) => n + e.installs, 0) };
  }).filter((t) => t.count > 0);
  const byChannel = RELEASE_CHANNELS.map((channel) => ({ channel, count: entries.filter((e) => e.channel === channel).length })).filter((c) => c.count > 0);
  const topPublishers = [...publishers].sort((a, b) => b.installs - a.installs).slice(0, 5);
  return {
    totalPackages: entries.length,
    totalPublishers: publishers.length,
    totalInstalls,
    updatesAvailable: updates,
    rollbackRate: totalInstalls > 0 ? Math.min(1, rollbacks / totalInstalls) : 0,
    byType,
    byChannel,
    topPublishers,
    adoption: entries.length > 0 ? installed.length / entries.length : 0,
  };
}

/** The install decision combining governance verdict + capability. */
export function canInstall(entry: MarketplaceEntry, verdict: MarketplaceVerdict): { allowed: boolean; decision: MarketplaceDecision; routable: boolean } {
  return {
    allowed: verdict.decision !== 'deny',
    decision: verdict.decision,
    routable: entry.capability === 'installable',
  };
}
