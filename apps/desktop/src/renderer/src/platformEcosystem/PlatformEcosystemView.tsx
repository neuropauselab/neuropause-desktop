/**
 * Platform Ecosystem (Phase 5) — the enterprise extensibility control plane.
 *
 * The control-plane counterpart to the org-facing Ecosystem storefront. ONE workspace
 * that composes the platform's existing extensibility surfaces — extensions, developer
 * platform, marketplace, AI agents, connectors, partners, governance and analytics —
 * into reuse-only lenses with an honest gap catalog. It fetches EXISTING `ipc.*` data
 * once, runs each tab's pure/tested model, and renders uniformly. It creates no runtime,
 * IPC channel, or store; capabilities that already have full surfaces (marketplace,
 * connectors, agents, partners) are summarized and DEEP-LINKED rather than duplicated;
 * demo-seeded data (partner directory, exchange packs) renders honest-empty in
 * production; every missing capability is a labeled "Requires …" gap, never fabricated.
 */
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { useShell } from '@renderer/state/ShellProvider';
import type { SectionId } from '@renderer/shell/sections';
import { computeMaturity } from '@renderer/capability/capabilityRegistry';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat, StatusBadge, StatusDot } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { type OpLens, EMPTY_LENS } from '@renderer/aiOperations/aiOperationsModel';
import { summarizeExtensions } from './extensionsModel';
import { summarizeDeveloper } from './developerModel';
import { summarizeMarketplace } from './marketplaceModel';
import { summarizeAgents } from './agentsModel';
import { summarizeConnectors } from './connectorsModel';
import { summarizePartners } from './partnersModel';
import { summarizeGovernance } from './governanceModel';
import { summarizeAnalytics } from './analyticsModel';
import { type EcoTab, type EcoArea, ECO_AREAS, ecosystemAreas } from './platformEcosystemModel';

const TABS: { id: EcoTab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge' },
  ...ECO_AREAS.map((a) => ({ id: a.key, label: a.label, icon: a.icon })),
];

type Lenses = Record<EcoTab, OpLens>;

const INITIAL: Lenses = {
  overview: EMPTY_LENS, extensions: EMPTY_LENS, developer: EMPTY_LENS, marketplace: EMPTY_LENS,
  agents: EMPTY_LENS, connectors: EMPTY_LENS, partners: EMPTY_LENS, governance: EMPTY_LENS,
  analytics: EMPTY_LENS,
};

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

function gridCols(n: number): 2 | 3 | 4 {
  const c = Math.min(4, Math.max(2, n));
  return (c === 4 ? 4 : c === 3 ? 3 : 2) as 2 | 3 | 4;
}

function LensView({ lens, go }: { lens: OpLens; go: (s: SectionId) => void }): JSX.Element {
  const hasBody = lens.stats.length > 0 || lens.groups.some((g) => g.rows.length > 0);
  return (
    <div className="space-y-6">
      {lens.stats.length > 0 && (
        <Grid cols={gridCols(lens.stats.length)}>
          {lens.stats.map((s, i) => (
            <Stat key={i} icon={s.icon} label={s.label} value={s.value} tone={s.tone} hint={s.hint} />
          ))}
        </Grid>
      )}

      {lens.groups.map((g, i) => (
        <OpsPanel key={i} title={g.title} subtitle={g.note}>
          <div className="space-y-1">
            {g.rows.length > 0 ? (
              g.rows.map((r, j) => (
                <div
                  key={j}
                  className="flex items-center justify-between gap-4 border-b border-[var(--hairline)] py-1.5 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm">{r.label}</div>
                    {r.sub && <div className="text-xs text-faint">{r.sub}</div>}
                  </div>
                  <div className="shrink-0 text-sm tabular-nums">
                    {r.tone ? <StatusBadge tone={r.tone} label={r.value} /> : r.value}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="No live data yet" hint="This surface stays empty until its source is populated." />
            )}
          </div>
        </OpsPanel>
      ))}

      {lens.gaps.length > 0 && (
        <OpsPanel title="Honest gaps" subtitle="Capabilities without real backing today — labeled, never fabricated.">
          <div className="space-y-2">
            {lens.gaps.map((gp, i) => (
              <div key={i} className="flex items-start gap-3 border-b border-[var(--hairline)] py-1.5 last:border-0">
                <Icon name="info" size={15} className="mt-0.5 shrink-0 text-faint" />
                <div className="min-w-0">
                  <div className="text-sm">{gp.capability}</div>
                  <div className="text-xs text-faint">Requires {gp.requires}</div>
                  {gp.note && <div className="text-xs text-faint">{gp.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {lens.links && lens.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {lens.links.map((l, i) => (
            <button
              key={i}
              onClick={() => go(l.section)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-sm transition-colors hover:bg-[var(--hover)]"
            >
              {l.icon && <Icon name={l.icon} size={15} />}
              <span>{l.label}</span>
              <Icon name="arrow-right" size={14} />
            </button>
          ))}
        </div>
      )}

      {!hasBody && lens.gaps.length === 0 && (
        <EmptyState title="No live data yet" hint="This surface stays empty until its source is populated." />
      )}
    </div>
  );
}

function OverviewView({ areas, onOpen }: { areas: EcoArea[]; onOpen: (t: EcoTab) => void }): JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-sm text-faint">
        Who can extend the platform, and how safely — composed read-only from the surfaces that already own each
        capability. Open an area for detail and its honest gaps.
      </p>
      <Grid cols={4}>
        {areas.map((a) => (
          <button
            key={a.key}
            onClick={() => onOpen(a.key)}
            className="rounded-xl border border-[var(--hairline)] p-4 text-left transition-colors hover:bg-[var(--hover)]"
          >
            <div className="flex items-center gap-2">
              <Icon name={a.icon} size={16} />
              <span className="font-medium">{a.label}</span>
            </div>
            <div className="mt-2 truncate text-sm text-faint">{a.headline}</div>
            <div className="mt-3 flex items-center gap-2">
              <StatusDot tone={a.tone} />
              <span className="text-xs text-faint">
                {a.gaps > 0 ? `${a.gaps} honest gap${a.gaps === 1 ? '' : 's'}` : 'no gaps'}
              </span>
            </div>
          </button>
        ))}
      </Grid>
    </div>
  );
}

export function PlatformEcosystemView(): JSX.Element {
  const { setSection } = useShell();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<EcoTab>('overview');
  const [lenses, setLenses] = useState<Lenses>(INITIAL);

  const refresh = useCallback(async () => {
    const [
      pluginsList, extensionsList, registryStats,
      keys, devAnalytics, oauthApps, routes,
      catalog, mktAnalytics, metering,
      workers, wfIntel,
      connStats, connList,
      deployment, partners, account,
      mktPolicy, wfPolicies, govConfig, publishers,
      ecoAnalytics,
    ] = await Promise.all([
      settled(ipc.plugins.list(), undefined),
      settled(ipc.plugins.extensions(), undefined),
      settled(ipc.registry.stats(), undefined),
      settled(ipc.ecosystem.keys(), undefined),
      settled(ipc.developerPlatform.analytics(), undefined),
      settled(ipc.ecosystem.oauthApps(), undefined),
      settled(ipc.api.routes(), undefined),
      settled(ipc.marketplace.catalog(), undefined),
      settled(ipc.marketplace.analytics(), undefined),
      settled(ipc.commercial.metering(), undefined),
      settled(ipc.workforce.workers(), undefined),
      settled(ipc.workforce.intelligence(), undefined),
      settled(ipc.connectors.stats(), undefined),
      settled(ipc.connectors.list(), undefined),
      settled(ipc.commercial.deployment(), undefined),
      settled(ipc.ecosystem.partners(), undefined),
      settled(ipc.ecosystem.account(), undefined),
      settled(ipc.marketplace.policy(), undefined),
      settled(ipc.workforce.policies(), undefined),
      settled(ipc.enterprise.governanceConfig(), undefined),
      settled(ipc.marketplace.publishers(), undefined),
      settled(ipc.ecosystem.analytics(), undefined),
    ]);

    const maturity = computeMaturity();

    setLenses({
      overview: EMPTY_LENS,
      extensions: summarizeExtensions({ plugins: pluginsList, extensions: extensionsList, registry: registryStats }),
      developer: summarizeDeveloper({ keys, analytics: devAnalytics, apps: oauthApps, routes }),
      marketplace: summarizeMarketplace({ listings: catalog, analytics: mktAnalytics, metering }),
      agents: summarizeAgents({ workers, intelligence: wfIntel }),
      connectors: summarizeConnectors({ stats: connStats, connectors: connList }),
      partners: summarizePartners({
        deployment,
        partnerDirectory: partners,
        oauthApps,
        apiPartnerTier: account?.planTier ?? null,
        federationPartnerScope: true,
      }),
      governance: summarizeGovernance({
        marketplacePolicy: mktPolicy,
        workforcePolicies: wfPolicies,
        governance: govConfig,
        workers,
        publishers,
        packages: catalog,
      }),
      analytics: summarizeAnalytics({
        developer: devAnalytics,
        marketplace: mktAnalytics,
        ecosystem: ecoAnalytics,
        maturity,
      }),
    });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    const offs = [
      ipc.marketplace.onEvent(() => void refresh()),
      ipc.connectors.onEvent(() => void refresh()),
      ipc.workforce.onEvent(() => void refresh()),
    ];
    return () => offs.forEach((off) => off());
  }, [refresh]);

  const go = (s: SectionId): void => setSection(s);
  const areas = ecosystemAreas(lenses);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--hairline)] px-8 pt-7">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Extensibility</h1>
          <p className="mt-0.5 text-sm text-faint">
            The Platform Ecosystem control plane — how organizations, developers, partners and AI agents extend the
            platform, composed read-only with honest gaps.
          </p>
        </div>
        <nav className="mt-5 flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  'flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors ' +
                  (active
                    ? 'border-[var(--accent)] text-strong'
                    : 'border-transparent text-faint hover:text-strong')
                }
              >
                <Icon name={t.icon} size={15} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {!ready ? (
          <LoadingBlock label="Composing the platform ecosystem…" />
        ) : tab === 'overview' ? (
          <OverviewView areas={areas} onOpen={setTab} />
        ) : (
          <LensView lens={lenses[tab]} go={go} />
        )}
      </div>
    </div>
  );
}
