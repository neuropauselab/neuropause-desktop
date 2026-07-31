/**
 * Phase 6 Stage 7 — the knowledge model: the ten question resolvers (7.11),
 * knowledge hygiene recommendations (7.8), the dashboard composition (7.10),
 * and the search lens (7.7 — a pure JOIN over the existing federated search;
 * no second engine, no index).
 *
 * Every answer cites real evidence ids, states the authority behind it,
 * declares uncertainty (classification confidence / heuristic joins), and
 * lists related knowledge from the computed matrix. A question the records
 * cannot answer gets an honest "not documented" — never an invented one.
 * Pure; all state injected.
 */
import type {
  AssistantStructuredReport,
  DecisionLineage,
  ExecutiveDecision,
  KnowledgeAsset,
  KnowledgeAssetDashboard,
  KnowledgeCoverageMap,
  KnowledgeImpactAnalysis,
  KnowledgeInventory,
  KnowledgeQualityReport,
  KnowledgeQuestionKey,
  KnowledgeRecommendation,
  KnowledgeSearchHit,
  StandardsReport,
} from '@neuropause/shared';
import { DOMAIN_KEYWORDS } from './assetRegistry';
import { topicOverlap, topicTokens, type ConnectorLite } from './assetInventory';
import type { MatrixBuild } from './relationshipMatrix';

/* ── question resolution (deterministic; disjoint from the Stage 5/6 matchers) ── */

export function resolveKnowledgeQuestion(text: string): KnowledgeQuestionKey | null {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return null;
  if (/\bwhy (was|is|were|did we (choose|pick|select))\b.*\b(architecture|architectural|design decision|adr)\b/.test(t) || /\bwhy .* (architecture|adr)\b.*\b(chosen|selected|picked)\b/.test(t))
    return 'why-architecture';
  if (/\b(what('s| is)? (our|the) )?(deployment|deploy|release) (policy|standard)\b/.test(t)) return 'deployment-policy';
  if (/\bwhich decision (approved|authorized|authorised)\b/.test(t)) return 'which-decision-approved';
  if (/\b(show|list) (me )?(every|all) discussions?\b/.test(t) || /\bdiscussions? (about|related to|for) (this|the) project\b/.test(t))
    return 'discussions-for-project';
  if (/\bwhich (sop|standard operating procedure)\b.*\bappl/.test(t) || /\bwhat sop applies\b/.test(t)) return 'which-sop';
  if (/\bwhat('s| is)? the current (company )?standard\b/.test(t) || /\bcurrent company standard\b/.test(t))
    return 'current-standard';
  if (/\bwhy do we use\b.*\b(connector|integration)?\b/.test(t) && /\b(connector|integration|slack|github|teams|jira|google|microsoft|notion|asana)\b/.test(t))
    return 'why-connector';
  if (/\bwhich (knowledge|documentation|docs) (is|are) (outdated|stale)\b/.test(t) || /\boutdated knowledge\b/.test(t))
    return 'outdated-knowledge';
  if (/\bwhich documents? conflict\b/.test(t) || /\bconflicting (documents?|policies)\b/.test(t))
    return 'conflicting-documents';
  if (/\bwhat (has )?changed in (our|the) .*standards?\b/.test(t) || /\bstandards? changes? (this|last)\b/.test(t))
    return 'standards-changes';
  return null;
}

/* ── the answer context ───────────────────────────────────────────────────── */

export interface KnowledgeQuestionContext {
  inventory: KnowledgeInventory;
  standards: StandardsReport;
  quality: KnowledgeQualityReport;
  matrixBuild: MatrixBuild;
  decisions: ExecutiveDecision[];
  connectors: ConnectorLite[];
  conversations: { id: string; title: string; updatedAt: string }[] | null;
  graphHistory: { at: string; action: string; label: string }[] | null;
  lineageFor: (decisionId: string) => DecisionLineage;
  impactFor: (recordOrAssetId: string) => KnowledgeImpactAnalysis;
  nowIso: string;
}

type Section = { title: string; lines: string[] };

function report(title: string, sections: Section[]): AssistantStructuredReport {
  return { kind: 'intelligence', title, sections: sections.filter((s) => s.lines.length > 0), grounded: true };
}

function assetLine(a: KnowledgeAsset): string {
  return `${a.title} — ${a.authorityRankKey} (rank ${a.authorityRank}), ${a.lifecycle ?? 'unclassified'}, ${a.freshness}${
    a.owner ? `, owner ${a.owner}` : ''
  } [${a.recordId}]`;
}

function authorityLines(assets: readonly KnowledgeAsset[]): string[] {
  return assets
    .slice(0, 3)
    .map((a) => `${a.title}: ${a.authorityTier} via ${a.sourceSystem} — precedence rank ${a.authorityRank} (${a.authorityRankKey}).`);
}

function uncertaintyLines(assets: readonly KnowledgeAsset[], extra: string[] = []): string[] {
  const lines = [...extra];
  const uncertain = assets.filter((a) => a.classificationConfidence < 1);
  for (const a of uncertain.slice(0, 3)) {
    lines.push(
      `“${a.title}” is classified with ${Math.round(a.classificationConfidence * 100)}% confidence (${a.classificationSignals.join('; ')}).`,
    );
  }
  return lines;
}

function relatedLines(ctx: KnowledgeQuestionContext, assets: readonly KnowledgeAsset[]): string[] {
  const lines: string[] = [];
  for (const a of assets.slice(0, 2)) {
    const impact = ctx.impactFor(a.recordId);
    for (const e of impact.entries.slice(0, 3)) {
      lines.push(`${a.title} ↔ ${e.title} (${e.kind}, via ${e.via}).`);
    }
  }
  return lines;
}

function subjectTokens(text: string): string[] {
  return topicTokens(
    text
      .toLowerCase()
      .replace(
        /\b(why|was|is|are|were|the|this|that|which|what|show|list|every|all|do|we|use|chosen|selected|decision|approved|discussions?|related|about|for|current|company|standard|policy|applies|conflict(ing)?|outdated|stale|changed|our|me|connector|integration)\b/g,
        ' ',
      ),
  );
}

function rankByOverlap<T>(items: readonly T[], tokens: readonly string[], of: (t: T) => string[]): T[] {
  if (tokens.length === 0) return [...items];
  return [...items]
    .map((i) => ({ i, s: topicOverlap(tokens, of(i)) }))
    .sort((a, b) => b.s - a.s)
    .filter((x, idx) => x.s > 0 || idx === 0)
    .map((x) => x.i);
}

/* ── the ten answers ──────────────────────────────────────────────────────── */

export function answerKnowledgeQuestion(
  key: KnowledgeQuestionKey,
  text: string,
  ctx: KnowledgeQuestionContext,
): AssistantStructuredReport {
  const assets = ctx.inventory.assets;
  const tokens = subjectTokens(text);

  switch (key) {
    case 'why-architecture': {
      const candidates = assets.filter(
        (a) =>
          (a.classId === 'governed-document' && a.subkind === 'adr') ||
          (a.classId === 'executive-decision' && a.domains.includes('engineering')) ||
          (a.classId === 'explicit-memory' && a.topics.includes('architecture')),
      );
      const ranked = rankByOverlap(candidates, tokens, (a) => a.topics);
      if (ranked.length === 0) {
        return report('Why was this architecture chosen?', [
          {
            title: 'Answer',
            lines: [
              'Not documented: no ADR, engineering decision, or architecture memory exists in the connected records.',
            ],
          },
          { title: 'Evidence', lines: [`Inventory generated ${ctx.inventory.generatedAt}: 0 matching assets across ${ctx.inventory.totals.assets}.`] },
          { title: 'Uncertainty', lines: ['If the rationale lives in an unconnected system, it is invisible here — nothing was invented in its place.'] },
        ]);
      }
      const top = ranked[0];
      const lineage = top.classId === 'executive-decision' ? ctx.lineageFor(top.recordId) : null;
      return report('Why was this architecture chosen?', [
        { title: 'Answer', lines: ranked.slice(0, 3).map(assetLine) },
        ...(lineage && lineage.found
          ? [
              {
                title: 'Decision lineage',
                lines: lineage.stages.filter((s) => s.present).map((s) => `${s.stage}: ${s.summary ?? ''} (confidence ${s.confidence})`),
              },
            ]
          : []),
        { title: 'Evidence', lines: ranked.slice(0, 3).flatMap((a) => a.evidence.slice(0, 3)) },
        { title: 'Authority', lines: authorityLines(ranked) },
        { title: 'Uncertainty', lines: uncertaintyLines(ranked, tokens.length === 0 ? ['No specific subject was named; showing the closest architecture records.'] : []) },
        { title: 'Related knowledge', lines: relatedLines(ctx, ranked) },
      ]);
    }

    case 'deployment-policy':
    case 'current-standard': {
      const domainsAsked =
        key === 'deployment-policy'
          ? (['deployment'] as const)
          : DOMAIN_KEYWORDS.filter((d) => d.keywords.some((k) => text.toLowerCase().includes(k))).map((d) => d.domain);
      const wanted = domainsAsked.length > 0 ? domainsAsked : ctx.standards.domains.map((d) => d.domain);
      const rows = ctx.standards.domains.filter((d) => (wanted as readonly string[]).includes(d.domain));
      const title = key === 'deployment-policy' ? 'What is our deployment policy?' : 'What is the current company standard?';
      const defined = rows.filter((r) => r.defined);
      return report(title, [
        {
          title: 'Answer',
          lines:
            defined.length === 0
              ? [
                  `No standard is defined for ${rows.map((r) => r.label.toLowerCase()).join(', ')} — a documentation gap, stated honestly.`,
                ]
              : defined.flatMap((r) =>
                  r.current.map((c) => `${r.label}: “${c.title}” (${c.rankKey}, rank ${c.rank}, ${c.freshness}${c.updatedAt ? `, updated ${c.updatedAt.slice(0, 10)}` : ''}).`),
                ),
        },
        {
          title: 'Evidence',
          lines: defined.flatMap((r) => r.current.map((c) => c.assetId)),
        },
        {
          title: 'Authority',
          lines: defined
            .filter((r) => r.resolution)
            .slice(0, 3)
            .map((r) => `${r.label}: ${r.candidates} candidate(s) resolved by ${r.resolution?.method}.`),
        },
        {
          title: 'Uncertainty',
          lines: rows.filter((r) => !r.defined).map((r) => `${r.label}: no defining asset exists.`),
        },
      ]);
    }

    case 'which-decision-approved': {
      const approved = ctx.decisions.filter((d) =>
        ['accepted', 'in_progress', 'completed'].includes(d.status),
      );
      const ranked = rankByOverlap(approved, tokens, (d) => topicTokens(d.title));
      const top = ranked.length > 0 ? ranked[0] : null;
      const match = top && (tokens.length === 0 || topicOverlap(tokens, topicTokens(top.title)) > 0);
      if (!top || !match) {
        return report('Which decision approved this?', [
          { title: 'Answer', lines: ['No approved decision matches — either it was never recorded as a decision, or the approval lives in an unconnected system.'] },
          { title: 'Evidence', lines: [`${approved.length} approved decision(s) checked against the question's subject.`] },
        ]);
      }
      const lineage = ctx.lineageFor(top.id);
      const approval = lineage.stages.find((s) => s.stage === 'approval');
      return report('Which decision approved this?', [
        { title: 'Answer', lines: [`“${top.title}” (${top.id}) — status ${top.status}, owner ${top.owner || 'unassigned'}.`] },
        {
          title: 'Approval',
          lines: approval && approval.present ? [`${approval.summary ?? ''} at ${approval.at ?? 'unknown'}.`] : ['Accepted state present; no separate approval event recorded.'],
        },
        { title: 'Evidence', lines: [top.id, ...top.evidence.slice(0, 4), ...(approval?.evidence.slice(0, 2) ?? [])] },
        { title: 'Authority', lines: ['governed-decision (precedence rank 1) — the decision store is the highest authority.'] },
        { title: 'Uncertainty', lines: tokens.length === 0 ? ['No specific workflow was named; showing the closest approved decision.'] : [] },
      ]);
    }

    case 'discussions-for-project': {
      const convs = rankByOverlap(ctx.conversations ?? [], tokens, (c) => topicTokens(c.title)).slice(0, 6);
      const discussedRelations = ctx.matrixBuild.relations.filter((r) => r.edgeSource.includes('discussed_in'));
      const memoryAssets = rankByOverlap(
        assets.filter((a) => a.classId === 'explicit-memory'),
        tokens,
        (a) => a.topics,
      ).slice(0, 4);
      const lines = [
        ...convs.map((c) => `Conversation: “${c.title}” (updated ${c.updatedAt.slice(0, 10)}) [${c.id}]`),
        ...memoryAssets.map((m) => `Memory: ${assetLine(m)}`),
      ];
      return report('Every discussion related to this project', [
        { title: 'Answer', lines: lines.length > 0 ? lines : ['No recorded discussion matches — conversations and memories were searched; nothing was invented.'] },
        { title: 'Evidence', lines: [...convs.map((c) => c.id), ...memoryAssets.flatMap((m) => m.evidence.slice(0, 2))] },
        { title: 'Authority', lines: ['Conversations are runtime-recorded; memories are authored (precedence rank 7).'] },
        {
          title: 'Uncertainty',
          lines: [
            discussedRelations.length > 0
              ? `${discussedRelations.length} graph 'discussed_in' relation(s) also connect knowledge assets.`
              : 'Matching is by title/topic overlap — a declared heuristic; unconnected discussion systems are invisible here.',
          ],
        },
      ]);
    }

    case 'which-sop': {
      const sops = rankByOverlap(
        assets.filter((a) => a.classId === 'governed-document' && a.subkind === 'sop'),
        tokens,
        (a) => a.topics,
      );
      if (sops.length === 0) {
        return report('Which SOP applies?', [
          { title: 'Answer', lines: ['No SOP-classified document exists in the connected records — a documentation gap.'] },
          { title: 'Evidence', lines: [`${assets.filter((a) => a.classId === 'governed-document').length} governed document(s) checked.`] },
        ]);
      }
      return report('Which SOP applies?', [
        { title: 'Answer', lines: sops.slice(0, 3).map(assetLine) },
        { title: 'Evidence', lines: sops.slice(0, 3).flatMap((a) => a.evidence.slice(0, 2)) },
        { title: 'Authority', lines: authorityLines(sops) },
        { title: 'Uncertainty', lines: uncertaintyLines(sops.slice(0, 3)) },
        { title: 'Related knowledge', lines: relatedLines(ctx, sops) },
      ]);
    }

    case 'why-connector': {
      const ranked = rankByOverlap(ctx.connectors, tokens, (c) => topicTokens(`${c.name} ${c.provider}`));
      const conn = ranked.length > 0 ? ranked[0] : null;
      if (!conn || (tokens.length > 0 && topicOverlap(tokens, topicTokens(`${conn.name} ${conn.provider}`)) === 0)) {
        return report('Why do we use this connector?', [
          { title: 'Answer', lines: ['No configured connector matches that name.'] },
          { title: 'Evidence', lines: [`${ctx.connectors.length} configured/connected connector(s) checked.`] },
        ]);
      }
      const impact = ctx.impactFor(conn.id);
      const citing = impact.entries.filter((e) => e.kind === 'decision' || e.kind === 'memory' || e.kind === 'document');
      return report(`Why do we use ${conn.name}?`, [
        {
          title: 'Answer',
          lines: [
            `${conn.name}: ${conn.description}`,
            `${conn.accounts.length} connected account(s); manifest v${conn.version}${conn.lastSyncAt ? `; last sync ${conn.lastSyncAt.slice(0, 10)}` : ''}.`,
            ...(citing.length > 0
              ? citing.slice(0, 3).map((e) => `Referenced by ${e.kind}: “${e.title}” (via ${e.via}).`)
              : ['No recorded decision or memory documents the adoption rationale — the manifest description above is the provider\'s own.']),
          ],
        },
        { title: 'Evidence', lines: [conn.id, ...(conn.docsUrl ? [conn.docsUrl] : []), ...citing.slice(0, 3).flatMap((e) => e.evidence.slice(0, 2))] },
        { title: 'Authority', lines: ['provider-document (precedence rank 6) — the manifest is provider-authoritative; adoption decisions, when recorded, outrank it.'] },
        { title: 'Uncertainty', lines: citing.length === 0 ? ['The organizational "why" is not recorded in connected systems.'] : [] },
      ]);
    }

    case 'outdated-knowledge': {
      const outdated = ctx.quality.findings.filter((f) => f.kind === 'outdated' || f.kind === 'review-overdue');
      return report('Which knowledge is outdated?', [
        {
          title: 'Answer',
          lines:
            outdated.length === 0
              ? ['Nothing is stale: every time-meaningful asset is inside its class staleness window.']
              : outdated.slice(0, 8).map((f) => `${f.title} — ${f.detail}`),
        },
        { title: 'Evidence', lines: outdated.slice(0, 8).flatMap((f) => f.evidence.slice(0, 2)) },
        { title: 'Authority', lines: outdated.slice(0, 3).map((f) => f.authority) },
        { title: 'Uncertainty', lines: [`Staleness windows are per-class (declared in the asset registry); ${ctx.inventory.totals.stale} stale asset(s) total.`] },
      ]);
    }

    case 'conflicting-documents': {
      const conflicts = ctx.quality.findings.filter((f) => f.kind === 'conflict');
      return report('Which documents conflict?', [
        {
          title: 'Answer',
          lines:
            conflicts.length === 0
              ? ['No conflicts detected: no two current same-class records overlap in domain and topic.']
              : conflicts.slice(0, 6).map((f) => f.detail),
        },
        { title: 'Evidence', lines: conflicts.slice(0, 6).flatMap((f) => f.evidence) },
        { title: 'Authority', lines: conflicts.slice(0, 3).map((f) => f.authority) },
        { title: 'Uncertainty', lines: conflicts.length > 0 ? ['Conflict detection requires cited topic overlap ≥ 0.5 — a declared heuristic (confidence 0.7 per finding).'] : [] },
      ]);
    }

    case 'standards-changes': {
      const cutoffMs = Date.parse(ctx.nowIso) - 30 * 86_400_000;
      const recent = assets.filter(
        (a) => a.domains.length > 0 && a.updatedAt !== null && Date.parse(a.updatedAt) >= cutoffMs,
      );
      const revisedPrompts = assets.filter((a) => a.classId === 'ai-prompt' && a.version !== 'v1');
      const history = (ctx.graphHistory ?? []).slice(0, 5);
      const lines = [
        ...recent.slice(0, 6).map((a) => `${a.updatedAt?.slice(0, 10)}: “${a.title}” updated (${a.domains.join(', ')}).`),
        ...revisedPrompts.slice(0, 3).map((a) => `Prompt standard “${a.title}” revised to ${a.version}.`),
        ...history.map((h) => `${h.at.slice(0, 10)}: relationship ${h.action} — ${h.label}.`),
      ];
      return report('What changed in our standards?', [
        { title: 'Answer', lines: lines.length > 0 ? lines : ['No standard-bearing asset changed in the last 30 days (and no relationship history was recorded).'] },
        { title: 'Evidence', lines: recent.slice(0, 6).map((a) => a.recordId) },
        { title: 'Authority', lines: authorityLines(recent) },
        { title: 'Uncertainty', lines: ['Change detection covers connected records and the graph relationship history only.'] },
      ]);
    }

    default:
      return report('Knowledge question', [
        { title: 'Answer', lines: ['Unrecognized knowledge question key.'] },
      ]);
  }
}

/* ── knowledge hygiene recommendations (7.8) ──────────────────────────────── */

const SEVERITY_TO_PRIORITY: Record<string, KnowledgeRecommendation['priority']> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

export function composeKnowledgeRecommendations(quality: KnowledgeQualityReport): KnowledgeRecommendation[] {
  return quality.findings.map((f) => ({
    id: `kr:${f.id}`,
    rule: f.kind,
    title: f.title,
    detail: f.detail,
    priority: SEVERITY_TO_PRIORITY[f.severity] ?? 'medium',
    evidence: f.evidence,
    authority: f.authority,
    confidence: f.confidence,
    suggestedAction: f.suggestedAction,
  }));
}

/* ── the dashboard (7.10) ─────────────────────────────────────────────────── */

export interface DashboardInputs {
  inventory: KnowledgeInventory;
  quality: KnowledgeQualityReport;
  standards: StandardsReport;
  coverage: KnowledgeCoverageMap;
  matrixCells: number;
  matrixRelations: number;
  lineageReady: number;
  recommendations: KnowledgeRecommendation[];
  nowIso: string;
}

export function composeKnowledgeDashboard(inp: DashboardInputs): KnowledgeAssetDashboard {
  const reviewQueue = inp.inventory.assets
    .filter((a) => a.freshness === 'stale' || (a.owner === null && a.classId !== 'derived-intelligence' && a.classId !== 'connector-doc' && a.classId !== 'workflow-definition'))
    .sort((a, b) => (a.updatedAt ?? '') < (b.updatedAt ?? '') ? -1 : 1)
    .slice(0, 10)
    .map((a) => ({
      assetId: a.id,
      title: a.title,
      reason: a.freshness === 'stale' ? 'stale — past its class staleness window' : 'no owner recorded',
      owner: a.reviewOwner ?? a.owner,
    }));

  return {
    generatedAt: inp.nowIso,
    inventory: {
      total: inp.inventory.totals.assets,
      byClass: inp.inventory.byClass,
      gaps: inp.inventory.gaps,
      withOwner: inp.inventory.totals.withOwner,
      stale: inp.inventory.totals.stale,
    },
    quality: {
      overall: inp.quality.overall,
      findings: inp.quality.findings.length,
      topFindings: inp.quality.findings.slice(0, 5),
      dimensions: inp.quality.dimensions,
    },
    standards: { defined: inp.standards.definedCount, total: inp.standards.totalDomains },
    coverage: inp.coverage,
    lineageReady: inp.lineageReady,
    recommendations: inp.recommendations.slice(0, 10),
    reviewQueue,
    matrix: { totalRelations: inp.matrixRelations, cells: inp.matrixCells },
    unavailable: [...inp.inventory.unavailable, ...inp.quality.unavailable].filter(
      (u, i, arr) => arr.findIndex((x) => x.system === u.system) === i,
    ),
  };
}

/* ── the search lens (7.7 — join only) ────────────────────────────────────── */

export interface SearchLensFilters {
  classId?: string;
  maxAuthorityRank?: number;
  lifecycle?: string;
}

export function knowledgeSearchLens(
  hits: readonly { source: string; id: string; kind: string; title: string; snippet: string | null; score: number }[],
  inventory: KnowledgeInventory,
  filters: SearchLensFilters = {},
): KnowledgeSearchHit[] {
  const byRecordId = new Map(inventory.assets.map((a) => [a.recordId, a]));
  const out: KnowledgeSearchHit[] = [];
  for (const h of hits) {
    const asset = byRecordId.get(h.id) ?? null;
    if (filters.classId && asset?.classId !== filters.classId) continue;
    if (filters.maxAuthorityRank !== undefined && (asset === null || asset.authorityRank > filters.maxAuthorityRank)) continue;
    if (filters.lifecycle && (asset === null || (asset.lifecycle ?? 'unclassified') !== filters.lifecycle)) continue;
    out.push({
      source: h.source,
      id: h.id,
      kind: h.kind,
      title: h.title,
      snippet: h.snippet,
      score: h.score,
      asset: asset
        ? {
            assetId: asset.id,
            classId: asset.classId,
            authorityRank: asset.authorityRank,
            lifecycle: asset.lifecycle,
            freshness: asset.freshness,
          }
        : null,
    });
  }
  return out;
}
