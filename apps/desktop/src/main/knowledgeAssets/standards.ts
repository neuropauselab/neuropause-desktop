/**
 * Phase 6 Stage 7 — Organizational Standards (7.6).
 *
 * The current standard for each of the eight domains is COMPOSED, never
 * authored: candidates are the inventory's assets tagged with the domain, and
 * the winner is picked by the enhancement-#4 deterministic authority
 * resolution (precedence → freshness → stable id). An empty domain reports
 * "no standard defined" — a first-class honest answer. Pure.
 */
import type {
  DomainStandard,
  KnowledgeAsset,
  StandardDomain,
  StandardsReport,
} from '@neuropause/shared';
import { STANDARD_DOMAINS } from '@neuropause/shared';
import { resolveAuthority } from './authorityResolution';

export const DOMAIN_LABELS: Record<StandardDomain, string> = {
  engineering: 'Engineering standards',
  deployment: 'Deployment policy',
  security: 'Security standards',
  'data-handling': 'Data handling',
  'ai-usage': 'AI usage',
  communication: 'Communication',
  operations: 'Operations',
  compliance: 'Compliance',
};

/** Classes whose records can DEFINE a standard (informational classes cannot). */
const STANDARD_BEARING_CLASSES = new Set([
  'executive-decision',
  'governance-policy',
  'compliance-rule',
  'governed-document',
  'explicit-memory',
  'ai-prompt',
  'org-structure',
]);

/** Non-current lifecycles never define the current standard. */
function isCurrent(a: KnowledgeAsset): boolean {
  return a.lifecycle !== 'archived' && a.lifecycle !== 'deprecated' && a.lifecycle !== 'superseded';
}

export function composeStandards(assets: readonly KnowledgeAsset[], nowIso: string): StandardsReport {
  const domains: DomainStandard[] = STANDARD_DOMAINS.map((domain) => {
    const candidates = assets.filter(
      (a) => STANDARD_BEARING_CLASSES.has(a.classId) && a.domains.includes(domain) && isCurrent(a),
    );
    if (candidates.length === 0) {
      return {
        domain,
        label: DOMAIN_LABELS[domain],
        defined: false,
        current: [],
        resolution: null,
        candidates: 0,
        note: 'No standard defined — no current asset speaks to this domain (a documentation gap, stated honestly).',
      };
    }
    const resolution = resolveAuthority(candidates);
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const winner = resolution.winnerAssetId ? byId.get(resolution.winnerAssetId) : undefined;
    /* the current standard = the winner, plus any co-equal assets at the same rank
       that are not in topic conflict (e.g. two security policies covering different areas) */
    const current = winner
      ? [winner, ...candidates.filter((c) => c.id !== winner.id && c.authorityRank === winner.authorityRank)].slice(0, 3)
      : [];
    return {
      domain,
      label: DOMAIN_LABELS[domain],
      defined: true,
      current: current.map((c) => ({
        assetId: c.id,
        title: c.title,
        rankKey: c.authorityRankKey,
        rank: c.authorityRank,
        updatedAt: c.updatedAt,
        freshness: c.freshness,
      })),
      resolution,
      candidates: candidates.length,
      note:
        candidates.length > 1
          ? `${candidates.length} candidates resolved by ${resolution.method}.`
          : 'Single defining asset for this domain.',
    };
  });

  return {
    generatedAt: nowIso,
    domains,
    definedCount: domains.filter((d) => d.defined).length,
    totalDomains: STANDARD_DOMAINS.length,
  };
}
