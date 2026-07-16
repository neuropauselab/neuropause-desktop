/**
 * P12 — Developer Center. The unified developer-experience surface over the EXISTING ecosystem
 * developer stack (developer account, API keys/OAuth, the gateway, billing, the public-API
 * registry, and marketplace publishing), built from house primitives + the P8.6 VirtualList.
 * Tabs: Overview (developer console + quota), SDKs (registry), API Explorer (public APIs),
 * Templates (authoring starters), Publishing (listing pipeline), and Analytics (gateway usage).
 * Reads via `ipc.developerPlatform.*`; refreshes on the existing `ecosystem:event` broadcast.
 * No new SDK, runtime, API server, or marketplace.
 */
import { useCallback, useEffect, useState } from 'react';
import type { DeveloperPlatformOverview } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { Bar, OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, Field, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill } from '@renderer/workforce/primitives';
import { VirtualList } from '@renderer/workforceCenter/VirtualList';
import {
  healthLabel,
  healthTone,
  listingStatusTone,
  sdkLangLabel,
  sdkStatusLabel,
  sdkStatusTone,
  templateIcon,
  templateLabel,
  tierLabel,
  tierTone,
  utilizationTone,
  visibilityTone,
} from './developerCenterModel';

type Tab = 'overview' | 'sdks' | 'apis' | 'templates' | 'publishing' | 'analytics';

export function DeveloperCenterView(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<DeveloperPlatformOverview | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const refresh = useCallback(async () => {
    try {
      setData(await ipc.developerPlatform.overview());
    } catch {
      /* keep last snapshot */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.developerPlatform.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: 'gauge' | 'code' | 'server' | 'puzzle' | 'store' | 'pulse' }[] = [
    { id: 'overview', label: 'Overview', icon: 'gauge' },
    { id: 'sdks', label: 'SDKs', icon: 'code' },
    { id: 'apis', label: 'API Explorer', icon: 'server' },
    { id: 'templates', label: 'Templates', icon: 'puzzle' },
    { id: 'publishing', label: 'Publishing', icon: 'store' },
    { id: 'analytics', label: 'Analytics', icon: 'pulse' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Developer Center</h1>
            <p className="mt-1 text-md text-muted">
              Build, test, publish, and manage enterprise extensions — one platform, one SDK, one gateway.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Refresh"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted fill-hover hover:text-ink"
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>

        <nav className="mb-6 flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition',
                tab === t.id ? 'bg-white/10 text-ink' : 'text-muted hover:bg-white/5 hover:text-ink',
              )}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </nav>

        {!ready ? (
          <LoadingBlock label="Loading developer platform…" />
        ) : !data ? (
          <EmptyState icon="code" title="Developer platform unavailable" hint="No developer-platform data could be loaded." />
        ) : tab === 'overview' ? (
          <Overview data={data} />
        ) : tab === 'sdks' ? (
          <Sdks data={data} />
        ) : tab === 'apis' ? (
          <Apis data={data} />
        ) : tab === 'templates' ? (
          <Templates data={data} />
        ) : tab === 'publishing' ? (
          <Publishing data={data} />
        ) : (
          <Analytics data={data} />
        )}
      </div>
    </div>
  );
}

function Code({ children }: { children: string }): JSX.Element {
  return <code className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-2xs text-muted">{children}</code>;
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function Overview({ data }: { data: DeveloperPlatformOverview }): JSX.Element {
  const { console: c } = data;
  return (
    <div>
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name="code" size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold tracking-tight">{c.developerName}</span>
            <Pill tone={tierTone(c.planTier)}>{tierLabel(c.planTier)}</Pill>
            <StatusBadge tone={healthTone(c.health)} label={healthLabel(c.health)} />
          </div>
          <div className="text-xs text-faint">{c.organization} · developer platform</div>
        </div>
      </div>

      <Grid cols={4}>
        <Stat icon="lock" label="API keys" value={c.apiKeys} />
        <Stat icon="puzzle" label="OAuth apps" value={c.oauthApps} tone="blue" />
        <Stat icon="store" label="Listings" value={`${c.published}/${c.listings}`} hint="published" tone="green" />
        <Stat icon="pulse" label="Requests (30d)" value={c.requests30d.toLocaleString()} tone="purple" />
      </Grid>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Quota" subtitle="API requests against the current plan" className="mb-0">
          <div className="rounded-2xl border border-[var(--hairline)] p-4">
            <Field label="Plan" value={tierLabel(c.planTier)} />
            <Field label="Used / limit" value={`${c.quotaUsed.toLocaleString()} / ${c.quotaLimit.toLocaleString()}`} />
            <Field label="Error rate (30d)" value={`${(c.errorRate30d * 100).toFixed(1)}%`} />
            <Field label="Pending review" value={c.pendingReview} />
            <div className="mt-2">
              <div className="mb-1 flex items-baseline justify-between text-2xs">
                <span className="text-faint">Quota utilization</span>
                <span className="tabular text-muted">{c.quotaUtilizationPct}%</span>
              </div>
              <Bar value={c.quotaUtilizationPct / 100} tone={utilizationTone(c.quotaUtilizationPct)} />
            </div>
          </div>
        </OpsPanel>

        <OpsPanel title="Platform" subtitle="SDKs, APIs, and starters available" className="mb-0">
          <div className="rounded-2xl border border-[var(--hairline)] p-4">
            <Field label="SDK languages" value={`${data.sdks.available} available · ${data.sdks.planned} planned`} />
            <Field label="Public APIs" value={`${data.apis.total} (${data.apis.publicApis} public · ${data.apis.partnerApis} partner)`} />
            <Field label="Templates" value={data.templates.total} />
            <Field label="Gateway versions" value={data.apis.versions.join(', ') || '—'} />
          </div>
        </OpsPanel>
      </div>
    </div>
  );
}

/* ── SDKs ────────────────────────────────────────────────────────────────── */

function Sdks({ data }: { data: DeveloperPlatformOverview }): JSX.Element {
  return (
    <OpsPanel title={`SDK registry · ${data.sdks.languages}`} subtitle="Official and planned client SDKs across languages">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.sdks.entries.map((s) => (
          <div key={s.language} className="rounded-2xl border border-[var(--hairline)] p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
                <Icon name="code" size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{sdkLangLabel(s.language)}</div>
                <div className="text-2xs text-faint">v{s.version}</div>
              </div>
              <Pill tone={sdkStatusTone(s.status)}>{sdkStatusLabel(s.status)}</Pill>
            </div>
            <p className="mt-2 text-2xs text-muted">{s.description}</p>
            <div className="mt-2">
              <Code>{s.install}</Code>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {s.capabilities.map((cap) => (
                <span key={cap} className="rounded-full border border-white/5 px-1.5 py-0.5 text-2xs text-faint">
                  {cap}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </OpsPanel>
  );
}

/* ── API Explorer ────────────────────────────────────────────────────────── */

function Apis({ data }: { data: DeveloperPlatformOverview }): JSX.Element {
  return (
    <OpsPanel title={`API Explorer · ${data.apis.total}`} subtitle="Public APIs fronted by the gateway (auth · scopes · rate limits)">
      {data.apis.apis.length === 0 ? (
        <EmptyState icon="server" title="No APIs" hint="Public APIs appear here as they are registered." />
      ) : (
        <div className="rounded-2xl border border-[var(--hairline)]">
          {data.apis.apis.map((a) => (
            <div key={a.id} className="flex items-start gap-3 border-b border-white/5 px-3 py-3 last:border-0">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted">
                <Icon name="server" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{a.name}</span>
                  <Pill tone={visibilityTone(a.visibility)}>{a.visibility}</Pill>
                  <span className="text-2xs text-faint">{a.rps} rps</span>
                </div>
                <div className="mt-0.5 text-2xs text-faint">
                  <Code>{`${a.version} ${a.basePath}`}</Code>
                </div>
                {a.scopes.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {a.scopes.map((sc) => (
                      <span key={sc} className="rounded-full border border-white/5 px-1.5 py-0.5 text-2xs text-faint">
                        {sc}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </OpsPanel>
  );
}

/* ── Templates ───────────────────────────────────────────────────────────── */

function Templates({ data }: { data: DeveloperPlatformOverview }): JSX.Element {
  return (
    <OpsPanel title={`Templates & starters · ${data.templates.total}`} subtitle="Scaffold extensions from the official authoring surfaces">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.templates.templates.map((t) => (
          <div key={t.id} className="rounded-2xl border border-[var(--hairline)] p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
                <Icon name={templateIcon(t.kind)} size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t.name}</div>
                <div className="text-2xs text-faint">{templateLabel(t.kind)} · {sdkLangLabel(t.language)}</div>
              </div>
            </div>
            <p className="mt-2 text-2xs text-muted">{t.summary}</p>
            <div className="mt-2"><Code>{t.scaffold}</Code></div>
            <div className="mt-2 text-2xs text-faint">→ {t.produces}</div>
          </div>
        ))}
      </div>
    </OpsPanel>
  );
}

/* ── Publishing ──────────────────────────────────────────────────────────── */

function Publishing({ data }: { data: DeveloperPlatformOverview }): JSX.Element {
  const p = data.publishing;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="doc" label="Draft" value={p.draft} />
        <Stat icon="clock" label="In review" value={p.inReview} tone="orange" />
        <Stat icon="check" label="Published" value={p.published} tone="green" />
        <Stat icon="checklist" label="Pending review" value={p.pendingReview} tone={p.pendingReview ? 'orange' : 'gray'} />
      </Grid>

      <OpsPanel title={`Listings · ${p.entries.length}`} subtitle="Your marketplace publishing pipeline" className="mt-6 mb-0">
        {p.entries.length === 0 ? (
          <EmptyState icon="store" title="No listings" hint="Create a listing, add a version from a manifest, submit, and publish." />
        ) : (
          <VirtualList
            items={p.entries}
            rowHeight={58}
            height={Math.min(560, Math.max(120, p.entries.length * 58))}
            rowKey={(e) => e.listingId}
            renderRow={(e) => (
              <div className="flex h-[54px] items-center gap-3 rounded-xl border border-white/5 px-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted">
                  <Icon name="store" size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {e.name}
                    {e.certified && <span className="ml-1.5 text-2xs text-faint">certified</span>}
                  </div>
                  <div className="truncate text-2xs text-faint">{e.kind} · {e.versions} version(s) · {e.installs} install(s){e.currentVersion ? ` · v${e.currentVersion}` : ''}</div>
                </div>
                <Pill tone={listingStatusTone(e.status)}>{e.status.replace('_', ' ')}</Pill>
              </div>
            )}
          />
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Analytics ───────────────────────────────────────────────────────────── */

function Analytics({ data }: { data: DeveloperPlatformOverview }): JSX.Element {
  const a = data.analytics;
  const maxDay = a.byDay.reduce((m, d) => Math.max(m, d.requests), 0) || 1;
  return (
    <div>
      <Grid cols={4}>
        <Stat icon="pulse" label={`Requests (${a.windowDays}d)`} value={a.requests.toLocaleString()} />
        <Stat icon="check" label="Allowed" value={a.allowed.toLocaleString()} tone="green" />
        <Stat icon="shield" label="Rate limited" value={a.rateLimited.toLocaleString()} tone={a.rateLimited ? 'orange' : 'gray'} />
        <Stat icon="lock" label="Unauthorized" value={a.unauthorized.toLocaleString()} tone={a.unauthorized ? 'red' : 'gray'} />
      </Grid>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Requests by day" subtitle={`p95 latency ${a.p95LatencyMs} ms`} className="mb-0">
          <div className="rounded-2xl border border-[var(--hairline)] p-4">
            {a.byDay.length === 0 ? (
              <p className="py-2 text-xs text-faint">No requests in the window.</p>
            ) : (
              a.byDay.slice(-14).map((d) => (
                <div key={d.day} className="mb-2 last:mb-0">
                  <div className="mb-1 flex items-baseline justify-between text-2xs">
                    <span className="text-faint">{d.day.slice(5)}</span>
                    <span className="tabular text-muted">{d.requests}{d.errors > 0 ? ` · ${d.errors} err` : ''}</span>
                  </div>
                  <Bar value={d.requests / maxDay} tone={d.errors > 0 ? 'orange' : 'green'} />
                </div>
              ))
            )}
          </div>
        </OpsPanel>

        <OpsPanel title="Top routes" subtitle="Most-called endpoints in the window" className="mb-0">
          <div className="rounded-2xl border border-[var(--hairline)] p-4">
            {a.topRoutes.length === 0 ? (
              <p className="py-2 text-xs text-faint">No routes yet.</p>
            ) : (
              a.topRoutes.map((r) => (
                <div key={r.route} className="flex items-center justify-between border-b border-white/5 py-1.5 text-xs last:border-0">
                  <Code>{r.route}</Code>
                  <span className="tabular text-muted">{r.requests}</span>
                </div>
              ))
            )}
          </div>
        </OpsPanel>
      </div>
    </div>
  );
}
