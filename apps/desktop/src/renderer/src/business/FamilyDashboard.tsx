/**
 * FamilyDashboard (Phase 7.2) — the live dashboard band of a Business family.
 *
 * Fetches the family's real records through the EXISTING generic
 * `enterprise:module.*` IPC, derives every widget with the pure
 * `familyDashboardModel`, and renders it with the shared ChartKit. No new
 * IPC, no new stores, no fabricated numbers: a family with no records shows
 * one honest empty state, and each widget appears only when live data backs
 * it. Accent widgets (treasury position, low stock, headcount, lead funnel,
 * expiring contracts) bind to verified module ids and field keys.
 */
import { useEffect, useState } from 'react';
import type { EnterpriseEntity } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { Card } from '@renderer/components/ui/Card';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { SkeletonLines } from '@renderer/components/ui/Skeleton';
import { ChartCard, NpBars, NpDonut, NpLine, TrendCard } from '@renderer/components/charts/ChartKit';
import type { BusinessFamilyGroup } from './businessModel';
import { buildFamilyDashboard, deriveSourceLineage, type FamilyDashboardData } from '@neuropause/shared';

/** Per-module fetch ceiling — local-first volumes; honest, not sampled silently. */
const RECORD_LIMIT = 400;

export function FamilyDashboard({ family }: { family: BusinessFamilyGroup }): JSX.Element {
  const [data, setData] = useState<FamilyDashboardData | null>(null);
  // NP-011 / FG-11 — the Intelligence-tile law on the family band: the numbers
  // name what they were computed over, via the ONE shared lineage rule.
  const [lineage, setLineage] = useState<string | null>(null);
  // Round 36 — Gate 15: modules whose record read FAILED (denied or faulted).
  const [failedModules, setFailedModules] = useState<string[]>([]);
  const [reloadNonce, setReloadNonce] = useState(0);
  const familyKey = family.modules.map((m) => m.id).join(',');

  useEffect(() => {
    let alive = true;
    setData(null);
    void (async () => {
      const failures: string[] = [];
      const entries = await Promise.all(
        family.modules.map(async (m) => {
          const rows = await ipc.enterpriseModules
            .records(m.id, { limit: RECORD_LIMIT })
            .catch(() => {
              failures.push(m.title ?? m.id);
              return [] as EnterpriseEntity[];
            });
          return [m.id, rows] as const;
        }),
      );
      if (!alive) return;
      setFailedModules(failures);
      const byModule = new Map<string, EnterpriseEntity[]>(entries);
      setLineage(deriveSourceLineage(entries.flatMap(([, rows]) => rows), 'records').sentence);
      setData(buildFamilyDashboard(family.meta.group, family.modules, byModule, new Date().toISOString()));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyKey, reloadNonce]);

  if (data === null) {
    return (
      <Card variant="hairline">
        <SkeletonLines rows={3} />
      </Card>
    );
  }

  if (failedModules.length > 0) {
    /**
     * Round 36 — Gate 15. The empty state below claims "this dashboard draws
     * every number from live records" — asserting groundedness at the exact
     * moment a read failed. A denied `finance:read` used to tell the user
     * their finance module was EMPTY and invite them to create a first
     * record. A failed read is its own state, and partial figures are never
     * presented as authoritative totals.
     */
    return (
      <div role="alert" className="rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
        <div className="font-semibold">Some {family.meta.label} records could not be read.</div>
        <p className="mt-1 text-xs leading-relaxed">
          {failedModules.join(', ')} failed to load — the numbers below would be incomplete, so none are
          shown. You may lack read permission for these modules.
        </p>
        <button
          type="button"
          onClick={() => setReloadNonce((n) => n + 1)}
          className="mt-3 rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-semibold hover:bg-danger/10"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data.hasRecords) {
    return (
      <EmptyState
        compact
        icon="analytics"
        title={`No ${family.meta.label} records yet`}
        description="This dashboard draws every number from live records — create the first record with a quick action below and it fills in immediately."
      />
    );
  }

  return (
    <div className="space-y-4" aria-label={`${family.meta.label} dashboard`}>
      {/* NP-011/FG-11 — the tile law: every number below names its register. */}
      {lineage !== null && <p className="text-xs text-faint">{lineage}</p>}
      {/* Real headline numbers */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {data.kpis.slice(0, 4).map((kpi, i) => (
          <TrendCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            hint={kpi.hint}
            spark={i === data.kpis.length - 1 || data.kpis.length === 1 ? data.creationTrend : undefined}
            sparkKey="count"
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Records created"
          subtitle="Last 6 months, from record history"
          empty={data.creationTrend.every((r) => r.count === 0)}
          emptyHint="Creation history fills in as records are added."
        >
          <NpLine data={data.creationTrend} xKey="month" series={[{ key: 'count', label: 'Created' }]} height={190} />
        </ChartCard>

        {data.statusDonut ? (
          <ChartCard title={data.statusDonut.title} subtitle="Live records by their own status field">
            <NpDonut data={data.statusDonut.slices} />
          </ChartCard>
        ) : (
          <ChartCard
            title="Records by module"
            subtitle="Live record counts"
            empty={data.moduleBars.length === 0}
          >
            <NpBars
              data={data.moduleBars}
              xKey="name"
              bars={[{ key: 'active', label: 'Records' }]}
              height={190}
            />
          </ChartCard>
        )}
      </div>

      {/* Family accents — rendered only when live data backs them. */}
      {(data.funnel || data.headcountByDept || (data.lowStock && data.lowStock.length > 0) || data.statusDonut) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.funnel && (
            <ChartCard title={data.funnel.title} subtitle="Every stage from the lead module's own pipeline">
              <NpBars
                data={data.funnel.slices.map((s) => ({ name: s.name, value: s.value }))}
                xKey="name"
                bars={[{ key: 'value', label: 'Leads' }]}
                colorByRow
                tones={data.funnel.slices.map((s) => s.tone)}
                height={190}
              />
            </ChartCard>
          )}
          {data.headcountByDept && data.headcountByDept.length > 0 && (
            <ChartCard title="Headcount by department" subtitle="Active employees">
              <NpBars
                data={data.headcountByDept}
                xKey="name"
                bars={[{ key: 'active', label: 'Active' }]}
                height={190}
              />
            </ChartCard>
          )}
          {data.lowStock && data.lowStock.length > 0 && (
            <ChartCard title="Low stock" subtitle="At or below the product's own reorder level">
              <div className="space-y-1.5">
                {data.lowStock.map((p) => (
                  <div key={p.name} className="flex items-center gap-2 text-sm">
                    <span className="truncate text-ink">{p.name}</span>
                    <span className="ml-auto tabular-nums text-muted">
                      {p.available} <span className="text-faint">/ reorder at {p.reorderLevel}</span>
                    </span>
                  </div>
                ))}
              </div>
            </ChartCard>
          )}
          {data.statusDonut && data.moduleBars.length > 1 && (
            <ChartCard title="Records by module" subtitle="Live record counts">
              <NpBars
                data={data.moduleBars}
                xKey="name"
                bars={[{ key: 'active', label: 'Records' }]}
                height={190}
              />
            </ChartCard>
          )}
        </div>
      )}
    </div>
  );
}
