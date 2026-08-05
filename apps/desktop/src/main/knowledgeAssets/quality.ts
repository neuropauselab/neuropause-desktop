/**
 * Phase 6 Stage 7 — Knowledge Quality (7.5): nine dimensions + eight
 * deterministic finding rules, every finding evidence-cited.
 *
 * NOTHING is invented: an unowned asset is a finding (not a guessed owner), a
 * conflict requires cited overlapping evidence and names its authority-
 * precedence winner (enhancement #4), broken references only flag id-shaped
 * evidence strings that resolve nowhere (free-text evidence like "PR #214" is
 * not an id and is never flagged — the heuristic is declared in the finding),
 * and a dimension whose inputs are unavailable scores null. Pure.
 */
import type {
  KnowledgeAsset,
  KnowledgeQualityDimension,
  KnowledgeQualityFinding,
  KnowledgeQualityReport,
  KnowledgeUnavailable,
  StandardsReport,
} from '@neuropause/shared';
import { resolveAuthority } from './authorityResolution';
import { overlapWithSet } from './assetInventory';

export interface QualityInput {
  assets: KnowledgeAsset[];
  standards: StandardsReport | null;
  /** Every record id known to the platform (entities, memories, decisions, jobs, graph nodes…). */
  knownIds: Set<string> | null;
  nowIso: string;
  unavailable: KnowledgeUnavailable[];
}

/** Id-shaped strings only: a known prefix or a provider-style compound id. The
 *  heuristic is DECLARED in every broken-reference finding it produces. */
export function looksLikeRecordId(s: string): boolean {
  if (s.length < 6 || s.includes(' ')) return false;
  if (/^(https?|computer):\/\//.test(s)) return false; // URLs are links, not record ids
  return /^[a-z0-9-]+:[^:\s]/i.test(s) || /^(mem|dec|job|wf|ka|ins|asst)[_:.-]/i.test(s);
}

const OWNERSHIP_EXPECTED = new Set(['executive-decision', 'governed-document', 'explicit-memory']);

function findingId(kind: string, key: string): string {
  return `kq:${kind}:${key.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80)}`;
}

export function buildQualityReport(input: QualityInput): KnowledgeQualityReport {
  const { assets } = input;
  const findings: KnowledgeQualityFinding[] = [];

  /* ── rule 1: outdated ─────────────────────────────────────────────────── */
  for (const a of assets) {
    if (a.freshness !== 'stale') continue;
    findings.push({
      id: findingId('outdated', a.id),
      kind: 'outdated',
      severity: a.criticality === 'critical' || a.criticality === 'high' ? 'high' : 'medium',
      title: `Outdated: ${a.title}`,
      detail: `Last updated ${a.updatedAt ?? 'unknown'} — beyond the ${a.classId} staleness window.`,
      assetIds: [a.id],
      evidence: [a.recordId],
      authority: `${a.authorityRankKey} (rank ${a.authorityRank})`,
      confidence: 0.9,
      suggestedAction: 'Review the record and refresh or archive it through its existing governed write path.',
    });
  }

  /* ── rule 2: missing owner ────────────────────────────────────────────── */
  for (const a of assets) {
    if (a.owner !== null || !OWNERSHIP_EXPECTED.has(a.classId)) continue;
    findings.push({
      id: findingId('missing-owner', a.id),
      kind: 'missing-owner',
      severity: 'medium',
      title: `Unowned: ${a.title}`,
      detail: `No owner is recorded (${a.ownerResolution}).`,
      assetIds: [a.id],
      evidence: [a.recordId],
      authority: `${a.authorityRankKey} (rank ${a.authorityRank})`,
      confidence: 1,
      suggestedAction: 'Assign an owner on the backing record so review responsibility is clear.',
    });
  }

  /* ── rule 3: conflicts — CLUSTERED per (class, subkind, shared domain):
   *    current assets whose topics overlap (≥ 0.5) cluster together, and each
   *    cluster of ≥2 emits ONE cited finding naming the enhancement-#4
   *    precedence winner. Clustering keeps the scan near-linear and reads
   *    better than a pairwise explosion ("3 overlapping deployment policies"
   *    instead of 3 pairwise findings). ── */
  const conflictBuckets = new Map<string, KnowledgeAsset[]>();
  for (const a of assets) {
    if (a.lifecycle === 'archived' || a.lifecycle === 'deprecated' || a.lifecycle === 'superseded') continue;
    if (a.classId !== 'governed-document' && a.classId !== 'explicit-memory' && a.classId !== 'executive-decision')
      continue;
    const domains = a.domains.length > 0 ? a.domains : ['none'];
    for (const d of domains) {
      const key = `${a.classId}|${a.subkind ?? ''}|${d}`;
      const list = conflictBuckets.get(key) ?? [];
      list.push(a);
      conflictBuckets.set(key, list);
    }
  }
  const conflictClusterSeen = new Set<string>();
  const assetsInConflict = new Set<string>();
  for (const [bucketKey, list] of conflictBuckets) {
    if (list.length < 2) continue;
    const clusters: { rep: KnowledgeAsset; repSet: Set<string>; members: KnowledgeAsset[] }[] = [];
    for (const a of list) {
      let joined = false;
      for (const c of clusters) {
        if (overlapWithSet(a.topics, c.repSet, c.rep.topics.length) >= 0.5) {
          c.members.push(a);
          joined = true;
          break;
        }
      }
      if (!joined) clusters.push({ rep: a, repSet: new Set(a.topics), members: [a] });
    }
    const domain = bucketKey.slice(bucketKey.lastIndexOf('|') + 1);
    for (const c of clusters) {
      if (c.members.length < 2) continue;
      const clusterKey = c.members
        .map((m) => m.id)
        .sort()
        .join('|');
      if (conflictClusterSeen.has(clusterKey)) continue;
      conflictClusterSeen.add(clusterKey);
      for (const m of c.members) assetsInConflict.add(m.id);
      const resolution = resolveAuthority(c.members);
      const winner = resolution.ranked[0];
      findings.push({
        id: findingId('conflict', clusterKey),
        kind: 'conflict',
        severity: 'high',
        title: `Potential conflict: ${c.members.length} overlapping ${c.rep.classId}${c.rep.subkind ? `/${c.rep.subkind}` : ''} records${domain !== 'none' ? ` (${domain})` : ''}`,
        detail: `${c.members
          .slice(0, 3)
          .map((m) => `“${m.title}”`)
          .join(' vs ')}${c.members.length > 3 ? ` (+${c.members.length - 3} more)` : ''} — same class/subkind, shared domain, overlapping topics, all current. Precedence resolves to “${winner.title}” (${winner.rankKey}, rank ${winner.rank}).`,
        assetIds: c.members.slice(0, 8).map((m) => m.id),
        evidence: c.members.slice(0, 8).map((m) => m.recordId),
        authority: `resolved by ${resolution.method}: winner ${winner.rankKey}`,
        confidence: 0.7,
        suggestedAction: 'Reconcile the overlapping records; supersede or archive the outranked ones through their governed writes.',
      });
    }
  }

  /* ── rule 4: broken references (id-shaped evidence resolving nowhere) ─── */
  if (input.knownIds) {
    const known = input.knownIds;
    for (const a of assets) {
      const broken = a.evidence.filter((ev) => ev !== a.recordId && looksLikeRecordId(ev) && !known.has(ev));
      if (broken.length === 0) continue;
      findings.push({
        id: findingId('broken-reference', a.id),
        kind: 'broken-reference',
        severity: 'medium',
        title: `Broken reference(s) on: ${a.title}`,
        detail: `${broken.length} id-shaped evidence reference(s) resolve to no known record (heuristic: prefix/compound id shape). They may point at deleted or never-synced records.`,
        assetIds: [a.id],
        evidence: broken.slice(0, 6),
        authority: `${a.authorityRankKey} (rank ${a.authorityRank})`,
        confidence: 0.7,
        suggestedAction: 'Re-link the evidence on the backing record or remove the dangling references.',
      });
    }
  }

  /* ── rule 5: duplicates (normalized-equal titles, same class) ─────────── */
  const titleGroups = new Map<string, KnowledgeAsset[]>();
  for (const a of assets) {
    const key = `${a.classId}|${a.title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    const list = titleGroups.get(key) ?? [];
    list.push(a);
    titleGroups.set(key, list);
  }
  for (const list of titleGroups.values()) {
    if (list.length < 2) continue;
    findings.push({
      id: findingId('duplicate', list[0].id),
      kind: 'duplicate',
      severity: 'low',
      title: `Duplicate titles: “${list[0].title}” × ${list.length}`,
      detail: `${list.length} ${list[0].classId} records share the same normalized title.`,
      assetIds: list.map((a) => a.id),
      evidence: list.map((a) => a.recordId).slice(0, 6),
      authority: `${list[0].authorityRankKey} (rank ${list[0].authorityRank})`,
      confidence: 0.8,
      suggestedAction: 'Merge or disambiguate the records at their source.',
    });
  }

  /* ── rule 6: decisions without evidence ───────────────────────────────── */
  for (const a of assets) {
    if (a.classId !== 'executive-decision') continue;
    if (a.evidence.length > 1) continue; // [decisionId] alone = no real evidence refs
    findings.push({
      id: findingId('decision-without-evidence', a.id),
      kind: 'decision-without-evidence',
      severity: 'high',
      title: `Decision without evidence: ${a.title}`,
      detail: 'The decision records no evidence references — its rationale cannot be traced.',
      assetIds: [a.id],
      evidence: [a.recordId],
      authority: 'governed-decision (rank 1)',
      confidence: 1,
      suggestedAction: 'Attach the underlying evidence to the decision record.',
    });
  }

  /* ── rule 7: undocumented standards (from the composed standards) ─────── */
  if (input.standards) {
    for (const d of input.standards.domains) {
      if (d.defined) continue;
      findings.push({
        id: findingId('undocumented-standard', d.domain),
        kind: 'undocumented-standard',
        severity: 'medium',
        title: `No ${d.label.toLowerCase()} standard defined`,
        detail: 'No current asset defines a standard for this domain — a documentation gap, stated honestly.',
        assetIds: [],
        evidence: [`standards:${d.domain}:candidates=0`],
        authority: 'none — nothing to rank',
        confidence: 1,
        suggestedAction: `Author or sync a ${d.label.toLowerCase()} document, or record a governed decision for the domain.`,
      });
    }
  }

  /* ── rule 8: review overdue (stale + owned + no review/approval provenance
   *    inside the staleness window) ─────────────────────────────────────── */
  for (const a of assets) {
    if (a.freshness !== 'stale' || !a.owner) continue;
    const reviewed = a.provenance.some((p) => (p.stage === 'reviewed' || p.stage === 'approved') && p.at !== null);
    if (reviewed && a.updatedAt !== null) continue;
    findings.push({
      id: findingId('review-overdue', a.id),
      kind: 'review-overdue',
      severity: 'medium',
      title: `Review overdue: ${a.title}`,
      detail: `Stale and assigned to ${a.reviewOwner ?? a.owner} with no recorded review inside the staleness window.`,
      assetIds: [a.id],
      evidence: [a.recordId],
      authority: `${a.authorityRankKey} (rank ${a.authorityRank})`,
      confidence: 0.8,
      suggestedAction: `Ask ${a.reviewOwner ?? a.owner} to review the record through its existing write path.`,
    });
  }

  /* ── the nine dimensions ──────────────────────────────────────────────── */
  const total = assets.length;
  const pct = (n: number, d: number): number | null =>
    d === 0 ? null : Math.max(0, Math.min(100, Math.round((n / d) * 100)));
  const countBy = (kind: KnowledgeQualityFinding['kind']): number => findings.filter((f) => f.kind === kind).length;

  const timeMeaningful = assets.filter((a) => a.freshness !== 'unknown' || a.updatedAt !== null);
  const ownershipPool = assets.filter((a) => OWNERSHIP_EXPECTED.has(a.classId));
  const measurableConfidence =
    total > 0 ? Math.round((assets.reduce((s, a) => s + a.classificationConfidence, 0) / total) * 100) : null;

  const dimensions: KnowledgeQualityDimension[] = [
    {
      key: 'freshness',
      label: 'Freshness',
      score: pct(assets.filter((a) => a.freshness === 'fresh' || a.freshness === 'aging').length, timeMeaningful.length),
      detail: `${assets.filter((a) => a.freshness === 'stale').length} stale asset(s) of ${timeMeaningful.length} time-meaningful.`,
      findings: countBy('outdated'),
    },
    {
      key: 'ownership',
      label: 'Ownership',
      score: pct(ownershipPool.filter((a) => a.owner !== null).length, ownershipPool.length),
      detail: `${ownershipPool.filter((a) => a.owner === null).length} unowned of ${ownershipPool.length} ownership-expected asset(s).`,
      findings: countBy('missing-owner'),
    },
    {
      key: 'authority',
      label: 'Authority coverage',
      score: pct(assets.filter((a) => a.authorityRank <= 4).length, total),
      detail: 'Share of assets at approved-document authority or above (ranks 1–4).',
      findings: 0,
    },
    {
      key: 'evidence-integrity',
      label: 'Evidence integrity',
      score: input.knownIds
        ? pct(total - findings.filter((f) => f.kind === 'broken-reference').length, total)
        : null,
      detail: input.knownIds
        ? `${countBy('broken-reference')} asset(s) carry id-shaped references that resolve nowhere.`
        : 'Known-id index unavailable — integrity not measured (never guessed).',
      findings: countBy('broken-reference'),
    },
    {
      key: 'conflicts',
      label: 'Conflict freedom',
      score: pct(total - assetsInConflict.size, total),
      detail: `${conflictClusterSeen.size} conflict cluster(s) across ${assetsInConflict.size} asset(s), each cited with its precedence winner.`,
      findings: countBy('conflict'),
    },
    {
      key: 'coverage',
      label: 'Standards coverage',
      score: input.standards ? pct(input.standards.definedCount, input.standards.totalDomains) : null,
      detail: input.standards
        ? `${input.standards.definedCount}/${input.standards.totalDomains} standard domains defined.`
        : 'Standards report unavailable.',
      findings: countBy('undocumented-standard'),
    },
    {
      key: 'lifecycle-clarity',
      label: 'Lifecycle clarity',
      score: pct(assets.filter((a) => a.lifecycle !== null).length, total),
      detail: `${assets.filter((a) => a.lifecycle === null).length} asset(s) carry no lifecycle marker (reported, not guessed).`,
      findings: 0,
    },
    {
      key: 'review-discipline',
      label: 'Review discipline',
      score: pct(total - countBy('review-overdue'), total),
      detail: `${countBy('review-overdue')} owned asset(s) are stale with no recorded review.`,
      findings: countBy('review-overdue'),
    },
    {
      key: 'classification-confidence',
      label: 'Classification confidence',
      score: measurableConfidence,
      detail: 'Mean declared classifier confidence across the inventory.',
      findings: countBy('duplicate'),
    },
  ];

  const measurable = dimensions.filter((d) => d.score !== null);
  const overall =
    measurable.length > 0
      ? Math.round(measurable.reduce((s, d) => s + (d.score as number), 0) / measurable.length)
      : null;

  const SEVERITY_RANK: Record<KnowledgeQualityFinding['severity'], number> = {
    critical: 3,
    high: 2,
    medium: 1,
    low: 0,
  };
  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (a.id < b.id ? -1 : 1));

  return {
    generatedAt: input.nowIso,
    dimensions,
    findings,
    overall,
    unavailable: input.unavailable,
  };
}
