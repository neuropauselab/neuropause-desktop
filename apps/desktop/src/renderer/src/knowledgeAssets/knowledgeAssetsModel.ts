/**
 * Phase 6 Stage 7 — the Knowledge Platform tab's pure view-model (no DOM, no
 * React). Projects the composed knowledge dashboard into presentation rows:
 * class inventory rows with authority/gap honesty, quality dimension meters,
 * standards rows with the deterministic precedence winner, coverage-map rows
 * (enhancement #2), the review queue, and hygiene recommendation rows.
 * Everything renders what was computed — nothing is invented here.
 */
import type {
  KnowledgeAssetDashboard,
  KnowledgeQualityDimension,
  KnowledgeRecommendation,
} from '@neuropause/shared';

export type KnowledgeTone = 'green' | 'orange' | 'red' | 'blue' | 'gray';

export function coverageTone(status: string): KnowledgeTone {
  switch (status) {
    case 'covered':
      return 'green';
    case 'partial':
      return 'orange';
    case 'gap':
      return 'red';
    default:
      return 'gray';
  }
}

export function priorityTone(priority: string): KnowledgeTone {
  switch (priority) {
    case 'critical':
      return 'red';
    case 'high':
      return 'orange';
    case 'medium':
      return 'blue';
    default:
      return 'gray';
  }
}

/* ── header stats ─────────────────────────────────────────────────────────── */

export interface KnowledgeStat {
  label: string;
  value: string;
  hint: string;
  tone: KnowledgeTone;
}

export function headerStats(d: KnowledgeAssetDashboard): KnowledgeStat[] {
  const qualityText = d.quality.overall === null ? 'n/a' : `${d.quality.overall}/100`;
  return [
    {
      label: 'Knowledge assets',
      value: String(d.inventory.total),
      hint: `${d.inventory.byClass.length} classes with records · ${d.inventory.gaps.length} gap(s)`,
      tone: d.inventory.total > 0 ? 'blue' : 'gray',
    },
    {
      label: 'Quality',
      value: qualityText,
      hint: `${d.quality.findings} finding(s)`,
      tone: d.quality.overall === null ? 'gray' : d.quality.overall >= 75 ? 'green' : d.quality.overall >= 50 ? 'orange' : 'red',
    },
    {
      label: 'Standards',
      value: `${d.standards.defined}/${d.standards.total}`,
      hint: 'domains with a defined standard',
      tone: d.standards.defined === d.standards.total ? 'green' : d.standards.defined > 0 ? 'orange' : 'red',
    },
    {
      label: 'Decision lineage',
      value: String(d.lineageReady),
      hint: 'decisions with ≥3 composable stages',
      tone: d.lineageReady > 0 ? 'green' : 'gray',
    },
    {
      label: 'Relations',
      value: String(d.matrix.totalRelations),
      hint: `${d.matrix.cells} matrix cell(s) — computed, never stored`,
      tone: 'blue',
    },
  ];
}

/* ── inventory rows (classes + honest gaps) ───────────────────────────────── */

export interface ClassRow {
  classId: string;
  label: string;
  countText: string;
  authority: string;
  note: string | null;
  isGap: boolean;
}

export function classRows(d: KnowledgeAssetDashboard): ClassRow[] {
  const rows: ClassRow[] = d.inventory.byClass.map((c) => ({
    classId: c.classId,
    label: c.label,
    countText: String(c.count),
    authority: c.authorityTier,
    note: c.note,
    isGap: false,
  }));
  for (const g of d.inventory.gaps) {
    rows.push({ classId: g.classId, label: g.label, countText: '—', authority: '', note: g.reason, isGap: true });
  }
  return rows;
}

/* ── quality dimensions ───────────────────────────────────────────────────── */

export interface DimensionRow {
  key: string;
  label: string;
  scoreText: string;
  pct: number | null;
  tone: KnowledgeTone;
  detail: string;
}

export function dimensionRows(dimensions: KnowledgeQualityDimension[]): DimensionRow[] {
  return dimensions.map((dim) => ({
    key: dim.key,
    label: dim.label,
    scoreText: dim.score === null ? 'not measurable' : `${dim.score}/100`,
    pct: dim.score,
    tone: dim.score === null ? 'gray' : dim.score >= 75 ? 'green' : dim.score >= 50 ? 'orange' : 'red',
    detail: dim.detail,
  }));
}

/* ── standards + coverage rows ────────────────────────────────────────────── */

export interface StandardRow {
  domain: string;
  label: string;
  statusText: string;
  tone: KnowledgeTone;
  detail: string;
}

export function standardRows(d: KnowledgeAssetDashboard): StandardRow[] {
  return d.coverage.domains.map((row) => ({
    domain: row.domain,
    label: row.label,
    statusText: row.standardDefined
      ? `defined · ${row.assets} asset(s)`
      : row.assets > 0
        ? `${row.assets} asset(s), no standard`
        : 'no standard defined',
    tone: coverageTone(row.status),
    detail: row.note,
  }));
}

export interface UnitRow {
  unitId: string;
  name: string;
  detail: string;
  tone: KnowledgeTone;
}

export function unitRows(d: KnowledgeAssetDashboard): UnitRow[] {
  return d.coverage.units.map((u) => ({
    unitId: u.unitId,
    name: u.unitName,
    detail: `${u.ownedAssets} owned asset(s) · ${u.hasLead ? 'lead assigned' : 'no lead'}`,
    tone: coverageTone(u.status),
  }));
}

/* ── recommendations + review queue ───────────────────────────────────────── */

export interface RecommendationRow {
  id: string;
  title: string;
  detail: string;
  priority: string;
  tone: KnowledgeTone;
  confidencePct: number;
  evidenceCount: number;
  suggestedAction: string;
  authority: string;
}

export function recommendationRows(recos: KnowledgeRecommendation[]): RecommendationRow[] {
  return recos.map((r) => ({
    id: r.id,
    title: r.title,
    detail: r.detail,
    priority: r.priority,
    tone: priorityTone(r.priority),
    confidencePct: Math.round(r.confidence * 100),
    evidenceCount: r.evidence.length,
    suggestedAction: r.suggestedAction,
    authority: r.authority,
  }));
}

export interface ReviewRow {
  assetId: string;
  title: string;
  reason: string;
  ownerText: string;
}

export function reviewRows(d: KnowledgeAssetDashboard): ReviewRow[] {
  return d.reviewQueue.map((r) => ({
    assetId: r.assetId,
    title: r.title,
    reason: r.reason,
    ownerText: r.owner ?? 'unassigned',
  }));
}

/* ── honesty strip ────────────────────────────────────────────────────────── */

export function unavailableLines(d: KnowledgeAssetDashboard): string[] {
  return d.unavailable.map((u) => `${u.system}: ${u.reason}`);
}
