/**
 * Phase 6 Stage 7 — the Knowledge Platform tab (7.10), rendered inside the
 * existing Knowledge workspace. Pure presentation over the composed knowledge
 * dashboard: the asset inventory by class (declared gaps included), the nine
 * quality dimensions, standards + coverage across the eight organizational
 * domains (enhancement #2), org-unit ownership coverage, the review queue,
 * and the hygiene recommendations. Nothing here computes knowledge and
 * nothing mutates — every suggested action routes through the existing
 * governed write paths, outside this read-only surface.
 */
import { useMemo } from 'react';
import type { KnowledgeAssetDashboard } from '@neuropause/shared';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, ErrorBlock, LoadingBlock, Meter } from '@renderer/operationsCenter/primitives';
import {
  classRows,
  dimensionRows,
  headerStats,
  recommendationRows,
  reviewRows,
  standardRows,
  unavailableLines,
  unitRows,
} from './knowledgeAssetsModel';

type HostState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; dashboard: KnowledgeAssetDashboard };

export interface KnowledgeAssetsViewProps {
  state: HostState;
  onRefresh: () => void;
}

export function KnowledgeAssetsView(p: KnowledgeAssetsViewProps): JSX.Element {
  if (p.state.state === 'loading') return <LoadingBlock label="Composing the knowledge inventory…" />;
  if (p.state.state === 'error') return <ErrorBlock message={p.state.message} onRetry={p.onRefresh} />;
  return <Ready dashboard={p.state.dashboard} onRefresh={p.onRefresh} />;
}

function Ready({ dashboard: d, onRefresh }: { dashboard: KnowledgeAssetDashboard; onRefresh: () => void }): JSX.Element {
  const stats = useMemo(() => headerStats(d), [d]);
  const classes = useMemo(() => classRows(d), [d]);
  const dimensions = useMemo(() => dimensionRows(d.quality.dimensions), [d]);
  const standards = useMemo(() => standardRows(d), [d]);
  const units = useMemo(() => unitRows(d), [d]);
  const recos = useMemo(() => recommendationRows(d.recommendations), [d]);
  const review = useMemo(() => reviewRows(d), [d]);
  const unavailable = useMemo(() => unavailableLines(d), [d]);

  return (
    <div>
      {/* ── header stats + refresh ── */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center gap-2">
              <StatusBadge tone={s.tone} label={`${s.label}: ${s.value}`} />
              <span className="hidden text-2xs text-faint xl:inline" title={s.hint}>
                {s.hint}
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5 text-xs font-medium text-muted hover:text-ink"
        >
          <Icon name="pulse" size={13} /> Refresh
        </button>
      </div>

      {/* ── honesty strip ── */}
      {unavailable.length > 0 && (
        <div className="mb-4 rounded-xl border border-[var(--hairline)] p-3 text-2xs text-muted">
          <span className="font-semibold uppercase tracking-wide text-faint">Unavailable sources — </span>
          {unavailable.join(' · ')}
        </div>
      )}

      {/* ── inventory by class (declared gaps included, never fabricated) ── */}
      <OpsPanel
        title="Knowledge Asset Inventory"
        subtitle="Classifications of existing records — owner, authority, freshness, lifecycle, provenance; empty classes are documentation gaps"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {classes.map((c) => (
            <div key={c.classId} className="surface-raised rounded-2xl p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink">{c.label}</span>
                <StatusBadge tone={c.isGap ? 'gray' : 'blue'} label={c.isGap ? 'gap' : c.countText} />
              </div>
              <div className="mt-1 text-2xs text-faint">{c.isGap ? c.note : `${c.authority}${c.note ? ` — ${c.note}` : ''}`}</div>
            </div>
          ))}
        </div>
      </OpsPanel>

      {/* ── standards + domain coverage (enhancements #2/#4) ── */}
      <OpsPanel
        title="Standards & domain coverage"
        subtitle="Eight organizational domains — the current standard is resolved by authority precedence (governed decision → … → derived), never authored here"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {standards.map((s) => (
            <div key={s.domain} className="surface-raised rounded-2xl p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink">{s.label}</span>
                <StatusBadge tone={s.tone} label={s.statusText} />
              </div>
              <p className="mt-1 text-2xs leading-snug text-muted">{s.detail}</p>
            </div>
          ))}
        </div>
        {units.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Org-unit ownership coverage</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {units.map((u) => (
                <div key={u.unitId} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--hairline)] px-3 py-2">
                  <span className="truncate text-xs text-ink">{u.name}</span>
                  <StatusBadge tone={u.tone} label={u.detail} />
                </div>
              ))}
            </div>
          </div>
        )}
      </OpsPanel>

      {/* ── quality findings + hygiene recommendations ── */}
      <OpsPanel
        title="Knowledge hygiene"
        subtitle="Deterministic findings over the inventory — every recommendation cites evidence, states its authority context, and declares confidence"
      >
        {recos.length === 0 ? (
          <EmptyState icon="check" title="No hygiene findings" hint="Every classified asset is fresh, owned, referenced, and conflict-free — as computed, not assumed." />
        ) : (
          <div className="space-y-2">
            {recos.map((r) => (
              <div key={r.id} className="surface-raised rounded-2xl p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">{r.title}</span>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={r.tone} label={r.priority} />
                    <span className="text-2xs tabular-nums text-faint">{r.confidencePct}% conf · {r.evidenceCount} evidence</span>
                  </div>
                </div>
                <p className="mt-1 text-2xs leading-snug text-muted">{r.detail}</p>
                <p className="mt-1 text-2xs text-faint">
                  <span className="font-semibold">Suggested:</span> {r.suggestedAction} <span className="ml-2">Authority: {r.authority}</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      {/* ── review queue (enhancement #1 — review owners) ── */}
      <OpsPanel title="Review queue" subtitle="Stale or unowned assets, oldest first — review responsibility resolved through the real org chart">
        {review.length === 0 ? (
          <EmptyState icon="check" title="Nothing awaiting review" hint="No stale or unowned assets in the current inventory." />
        ) : (
          <div className="space-y-1.5">
            {review.map((r) => (
              <div key={r.assetId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--hairline)] px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs text-ink">{r.title}</div>
                  <div className="text-2xs text-faint">{r.reason}</div>
                </div>
                <span className="text-2xs text-muted">review owner: {r.ownerText}</span>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      {/* ── the nine quality dimensions (7.5) — null scores stay "not measurable" ── */}
      <OpsPanel title="Quality dimensions" subtitle="Nine measured dimensions over the inventory — a dimension without inputs reports 'not measurable', never a guessed score">
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
          {dimensions.map((dim) => (
            <div key={dim.key} className="mb-1" title={dim.detail}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-ink">{dim.label}</span>
                <span className="tabular-nums text-faint">{dim.scoreText}</span>
              </div>
              {dim.pct !== null && (
                <Meter value={Math.max(0, Math.min(1, dim.pct / 100))} tone={dim.tone === 'gray' ? 'accent' : dim.tone} label={dim.label} trailing={dim.scoreText} />
              )}
            </div>
          ))}
        </div>
      </OpsPanel>
    </div>
  );
}
