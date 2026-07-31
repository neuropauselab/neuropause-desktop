/**
 * Phase 6 Stage 7 — enhancement #2: the Knowledge Coverage Map.
 *
 * Measures documentation coverage across the eight organizational standard
 * domains AND across org units — computed from the inventory + standards +
 * the real org chart, stored nowhere. An empty domain/unit is a GAP row,
 * never padded. Pure.
 */
import type {
  CoverageDomainRow,
  CoverageStatus,
  CoverageUnitRow,
  KnowledgeAsset,
  KnowledgeCoverageMap,
  StandardsReport,
} from '@neuropause/shared';
import { STANDARD_DOMAINS } from '@neuropause/shared';
import type { OrgLite } from './assetInventory';
import { DOMAIN_LABELS } from './standards';

export function buildCoverageMap(
  assets: readonly KnowledgeAsset[],
  standards: StandardsReport,
  org: OrgLite | null,
  nowIso: string,
): KnowledgeCoverageMap {
  const standardByDomain = new Map(standards.domains.map((d) => [d.domain, d]));

  const domains: CoverageDomainRow[] = STANDARD_DOMAINS.map((domain) => {
    const domainAssets = assets.filter((a) => a.domains.includes(domain));
    const classes = [...new Set(domainAssets.map((a) => a.classId))];
    const fresh = domainAssets
      .map((a) => a.updatedAt)
      .filter((x): x is string => Boolean(x))
      .sort();
    const ranks = domainAssets.map((a) => a.authorityRank);
    const standardDefined = standardByDomain.get(domain)?.defined ?? false;
    let status: CoverageStatus;
    let note: string;
    if (domainAssets.length === 0) {
      status = 'gap';
      note = 'No knowledge asset speaks to this domain.';
    } else if (!standardDefined) {
      status = 'partial';
      note = `${domainAssets.length} asset(s) touch the domain but none defines a current standard.`;
    } else {
      const staleShare = domainAssets.filter((a) => a.freshness === 'stale').length / domainAssets.length;
      status = staleShare > 0.5 ? 'partial' : 'covered';
      note =
        status === 'covered'
          ? `${domainAssets.length} asset(s), standard defined.`
          : `Standard defined but ${Math.round(staleShare * 100)}% of the domain's assets are stale.`;
    }
    return {
      domain,
      label: DOMAIN_LABELS[domain],
      assets: domainAssets.length,
      classesPresent: classes,
      freshest: fresh.length > 0 ? fresh[fresh.length - 1] : null,
      bestAuthorityRank: ranks.length > 0 ? Math.min(...ranks) : null,
      standardDefined,
      status,
      note,
    };
  });

  const units: CoverageUnitRow[] = [];
  if (org && org.units.length > 0) {
    const ownersLower = new Map<string, number>();
    for (const a of assets) {
      if (!a.owner) continue;
      const k = a.owner.trim().toLowerCase();
      ownersLower.set(k, (ownersLower.get(k) ?? 0) + 1);
    }
    for (const unit of org.units) {
      const members = org.users.filter((u) => u.unitId === unit.id);
      let owned = 0;
      for (const m of members) owned += ownersLower.get(m.name.trim().toLowerCase()) ?? 0;
      const hasLead = Boolean(unit.leadUserId);
      const status: CoverageStatus = owned > 0 && hasLead ? 'covered' : owned > 0 || hasLead ? 'partial' : 'gap';
      units.push({ unitId: unit.id, unitName: unit.name, ownedAssets: owned, hasLead, status });
    }
  }

  return {
    generatedAt: nowIso,
    domains,
    units,
    coveredDomains: domains.filter((d) => d.status === 'covered').length,
    totalDomains: STANDARD_DOMAINS.length,
    note:
      units.length === 0
        ? 'Org-unit coverage unavailable (no org chart loaded); domain coverage computed from the inventory.'
        : 'Computed from the inventory, the composed standards, and the real org chart; stored nowhere.',
  };
}
