/**
 * P9 — Enterprise Marketplace desktop experience. A governed catalog over the ecosystem,
 * built from house primitives + the P8.6 VirtualList: Discover (stats, search, type filter,
 * virtualized catalog, package detail with the Trust Center + governed install), Publishers,
 * and Governance (the org marketplace policy). Reuses the AI Store's data via `ipc.marketplace`.
 * No new browsing framework, search engine, or state library.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  MarketplaceAnalytics,
  MarketplaceEntry,
  MarketplacePackageType,
  OrgMarketplacePolicy,
  PublisherProfile,
  PublisherTier,
  TrustReport,
} from '@neuropause/shared';
import { MARKETPLACE_PACKAGE_TYPES, PUBLISHER_TIERS } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { Bar, OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, ErrorBlock, Field, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill } from '@renderer/workforce/primitives';
import { VirtualList } from '@renderer/workforceCenter/VirtualList';
import {
  actionLabel,
  channelTone,
  decisionTone,
  isActionable,
  tierLabel,
  tierTone,
  trustTone,
  typeIcon,
  typeLabel,
} from './marketplaceModel';

type Tab = 'discover' | 'publishers' | 'governance';

export function MarketplaceView(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<MarketplaceEntry[]>([]);
  const [publishers, setPublishers] = useState<PublisherProfile[]>([]);
  const [analytics, setAnalytics] = useState<MarketplaceAnalytics | null>(null);
  const [policy, setPolicy] = useState<OrgMarketplacePolicy | null>(null);
  const [tab, setTab] = useState<Tab>('discover');

  const refresh = useCallback(async () => {
    try {
      const [cat, pubs, an, pol] = await Promise.all([
        ipc.marketplace.catalog({}),
        ipc.marketplace.publishers(),
        ipc.marketplace.analytics(),
        ipc.marketplace.policy(),
      ]);
      setCatalog(cat);
      setPublishers(pubs);
      setAnalytics(an);
      setPolicy(pol);
      setError(null);
      setReady(true);
    } catch (err) {
      // Honest failure: don't fall through to the same UI a healthy-but-empty
      // marketplace renders. Record the error so the view can say so.
      setError(err instanceof Error ? err.message : 'Failed to load the marketplace');
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = ipc.marketplace.onEvent(() => void refresh());
    return off;
  }, [refresh]);

  const tabs: { id: Tab; label: string; icon: 'store' | 'verified' | 'shield' }[] = [
    { id: 'discover', label: 'Discover', icon: 'store' },
    { id: 'publishers', label: 'Publishers', icon: 'verified' },
    { id: 'governance', label: 'Governance', icon: 'shield' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-8 py-7" style={{ maxWidth: 1320 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Enterprise Marketplace</h1>
            <p className="mt-1 text-md text-muted">
              Signed, governed, versioned packages — workers, connectors, templates, and packs — for your organization.
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
          <LoadingBlock label="Loading marketplace…" />
        ) : error && catalog.length === 0 ? (
          <ErrorBlock
            title="Couldn’t load the marketplace"
            message={error}
            onRetry={() => {
              setReady(false);
              void refresh();
            }}
          />
        ) : tab === 'discover' ? (
          <Discover catalog={catalog} analytics={analytics} onChanged={refresh} />
        ) : tab === 'publishers' ? (
          <Publishers publishers={publishers} />
        ) : (
          // Key on the persisted policy's updatedAt so a save (which changes the stamp)
          // remounts the editor with fresh state, while unrelated catalog refreshes — which
          // leave updatedAt unchanged — don't clobber in-progress edits.
          <Governance key={policy?.updatedAt ?? 'none'} policy={policy} onSaved={refresh} />
        )}
      </div>
    </div>
  );
}

/* ── Discover ────────────────────────────────────────────────────────────── */

function Discover({
  catalog,
  analytics,
  onChanged,
}: {
  catalog: MarketplaceEntry[];
  analytics: MarketplaceAnalytics | null;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const [q, setQ] = useState('');
  const [type, setType] = useState<MarketplacePackageType | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return catalog.filter(
      (e) =>
        (type === 'all' || e.packageType === type) &&
        (!s || e.name.toLowerCase().includes(s) || e.summary.toLowerCase().includes(s) || e.publisher.name.toLowerCase().includes(s)),
    );
  }, [catalog, q, type]);

  // Keep the selection valid against the CURRENT filter: advance to the first visible package
  // when nothing is selected or the selected package was filtered out by search/type.
  useEffect(() => {
    if (filtered.length > 0 && (!selectedId || !filtered.some((e) => e.id === selectedId))) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);
  const selected = filtered.find((e) => e.id === selectedId) ?? filtered[0] ?? null;
  const typesPresent = useMemo(() => [...new Set(catalog.map((e) => e.packageType))], [catalog]);

  return (
    <div>
      {analytics && (
        <Grid cols={4}>
          <Stat icon="package" label="Packages" value={analytics.totalPackages} />
          <Stat icon="verified" label="Publishers" value={analytics.totalPublishers} tone="blue" />
          <Stat icon="download" label="Installs" value={analytics.totalInstalls} tone="green" />
          <Stat icon="refresh" label="Updates" value={analytics.updatesAvailable} tone={analytics.updatesAvailable ? 'orange' : 'gray'} />
        </Grid>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <OpsPanel title={`Catalog · ${filtered.length}`} className="mb-0">
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <Icon name="search" size={15} className="text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search packages, publishers…"
              className="flex-1 bg-transparent text-sm outline-none focus-visible:shadow-focus placeholder:text-faint"
            />
          </div>
          <div className="mb-2 flex flex-wrap gap-1">
            <TypeChip label="All" active={type === 'all'} onClick={() => setType('all')} />
            {typesPresent.map((t) => (
              <TypeChip key={t} label={typeLabel(t)} active={type === t} onClick={() => setType(t)} />
            ))}
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon="search" title="No packages" hint="Try another search or type filter." />
          ) : (
            <VirtualList
              items={filtered}
              rowHeight={62}
              height={Math.min(560, Math.max(124, filtered.length * 62))}
              rowKey={(e) => e.id}
              renderRow={(e) => <CatalogRow entry={e} active={e.id === selectedId} onSelect={() => setSelectedId(e.id)} />}
            />
          )}
        </OpsPanel>

        <div>{selected ? <PackageDetail entry={selected} onChanged={onChanged} /> : <EmptyState icon="package" title="Select a package" hint="Inspect its trust, publisher, dependencies, and install." />}</div>
      </div>
    </div>
  );
}

function CatalogRow({ entry, active, onSelect }: { entry: MarketplaceEntry; active: boolean; onSelect: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex h-[58px] w-full items-center gap-2.5 rounded-xl border px-2.5 text-left transition',
        active ? 'border-white/30 bg-white/[0.05]' : 'border-white/5 hover:border-white/15',
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-muted">
        <Icon name={typeIcon(entry.packageType)} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{entry.name}</div>
        <div className="truncate text-2xs text-faint">{entry.publisher.name} · v{entry.version}</div>
      </div>
      {entry.installState === 'update_available' && <Pill tone="orange">update</Pill>}
      {entry.installState === 'installed' && <Pill tone="green">installed</Pill>}
      <Icon name="dot" size={10} className={trustTone(entry.trustScore) === 'green' ? 'text-white/70' : 'text-faint'} />
    </button>
  );
}

function TypeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-2xs font-medium transition',
        active ? 'border-white/30 bg-white/[0.06] text-ink' : 'border-white/5 text-faint hover:border-white/15',
      )}
    >
      {label}
    </button>
  );
}

function PackageDetail({ entry, onChanged }: { entry: MarketplaceEntry; onChanged: () => Promise<void> }): JSX.Element {
  const [trust, setTrust] = useState<TrustReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    setNotice(null);
    void ipc.marketplace.trust(entry.id).then((t) => {
      if (live) setTrust(t);
    });
    return () => {
      live = false;
    };
  }, [entry.id]);

  const install = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await ipc.marketplace.install(entry.id);
      setNotice({ tone: r.ok ? 'ok' : r.decision === 'require_approval' ? 'warn' : 'err', text: r.message });
      await onChanged();
    } catch {
      setNotice({ tone: 'err', text: 'Install not permitted (requires the marketplace/workforce authority).' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-start gap-3.5 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
          <Icon name={typeIcon(entry.packageType)} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-semibold tracking-tight">{entry.name}</h3>
            <Pill tone={tierTone(entry.publisher.tier)} icon={entry.publisher.tier !== 'unverified' ? 'verified' : undefined}>
              {tierLabel(entry.publisher.tier)}
            </Pill>
            <Pill tone={channelTone(entry.channel)}>{entry.channel}</Pill>
          </div>
          <div className="mt-0.5 text-xs text-faint">
            {typeLabel(entry.packageType)} · v{entry.version} · {entry.publisher.name}
          </div>
          <p className="mt-1.5 text-xs text-muted">{entry.summary}</p>
        </div>
        <div className="shrink-0 text-right">
          <button
            type="button"
            disabled={busy || !isActionable(entry)}
            onClick={() => void install()}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-ink transition hover:bg-white/15 disabled:opacity-40"
          >
            {actionLabel(entry)}
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={cn(
            'mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs',
            notice.tone === 'ok' ? 'border-white/15 text-white/80' : notice.tone === 'warn' ? 'border-white/20 text-white/90' : 'border-white/25 text-white',
          )}
        >
          <Icon name={notice.tone === 'ok' ? 'check' : 'info'} size={14} />
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--hairline)] p-4">
          <div className="mb-1.5 text-xs font-semibold tracking-tight">Trust Center</div>
          {trust ? (
            <>
              <Field label="Signature" value={trust.certificate === 'valid' ? 'Signed · verified' : trust.certificate} />
              <Field label="Publisher tier" value={tierLabel(trust.publisherTier)} />
              <Field label="Security scan" value={trust.scan} />
              <Field label="Compatible" value={trust.compatible ? 'Yes' : trust.compatibilityNote ?? 'No'} />
              <div className="mt-2">
                <div className="mb-1 flex items-baseline justify-between text-2xs">
                  <span className="text-faint">Trust score</span>
                  <span className="tabular text-muted">{Math.round(trust.trustScore * 100)}%</span>
                </div>
                <Bar value={trust.trustScore} tone={trustTone(trust.trustScore)} />
              </div>
              <div className="mt-3">
                <StatusBadge tone={decisionTone(trust.policy.decision)} label={`Org policy: ${trust.policy.decision.replace('_', ' ')}`} />
                {trust.policy.reasons.map((r, i) => (
                  <p key={i} className="mt-1 text-2xs text-faint">
                    {r}
                  </p>
                ))}
              </div>
            </>
          ) : (
            <p className="py-1 text-xs text-faint">Loading trust report…</p>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--hairline)] p-4">
          <div className="mb-1.5 text-xs font-semibold tracking-tight">Package</div>
          <Field label="Type" value={typeLabel(entry.packageType)} />
          <Field label="Category" value={entry.category} />
          <Field label="Channel" value={entry.channel} />
          <Field label="Installs" value={entry.installs.toLocaleString()} />
          <Field label="Rating" value={`${entry.rating.toFixed(1)} (${entry.ratingCount})`} />
          <Field label="Dependencies" value={entry.dependencies.length === 0 ? 'none' : entry.dependencies.length} />
        </div>
      </div>
    </div>
  );
}

/* ── Publishers ──────────────────────────────────────────────────────────── */

function Publishers({ publishers }: { publishers: PublisherProfile[] }): JSX.Element {
  return (
    <OpsPanel title={`Publishers · ${publishers.length}`} subtitle="Verified publishers and their aggregate trust">
      {publishers.length === 0 ? (
        <EmptyState icon="verified" title="No publishers" hint="Publishers appear here as listings are published." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {publishers.map((p) => (
            <div key={p.id} className="rounded-2xl border border-[var(--hairline)] p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
                  <Icon name={p.tier === 'unverified' ? 'user' : 'verified'} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <Pill tone={tierTone(p.tier)}>{tierLabel(p.tier)}</Pill>
                </div>
              </div>
              <div className="mt-3">
                <div className="mb-1 flex items-baseline justify-between text-2xs">
                  <span className="text-faint">Trust</span>
                  <span className="tabular text-muted">{Math.round(p.trustScore * 100)}%</span>
                </div>
                <Bar value={p.trustScore} tone={trustTone(p.trustScore)} />
              </div>
              <div className="mt-2 flex items-center justify-between text-2xs text-faint">
                <span>{p.listings} listing(s)</span>
                <span>{p.installs.toLocaleString()} install(s)</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </OpsPanel>
  );
}

/* ── Governance ──────────────────────────────────────────────────────────── */

function Governance({ policy, onSaved }: { policy: OrgMarketplacePolicy | null; onSaved: () => Promise<void> }): JSX.Element {
  const [requireApproval, setRequireApproval] = useState(policy?.requireApproval ?? false);
  const [requireSignature, setRequireSignature] = useState(policy?.requireSignature ?? false);
  const [minTier, setMinTier] = useState<PublisherTier>(policy?.minPublisherTier ?? 'unverified');
  const [blockedTypes, setBlockedTypes] = useState<MarketplacePackageType[]>(policy?.blockedTypes ?? []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaved(null);
    try {
      await ipc.marketplace.setPolicy({
        requireApproval,
        requireSignature,
        minPublisherTier: minTier,
        blockedTypes,
        allowedPublishers: policy?.allowedPublishers ?? [],
        blockedPublishers: policy?.blockedPublishers ?? [],
      });
      setSaved('Policy saved.');
      await onSaved();
    } catch {
      setSaved('Not permitted — requires marketplace:manage.');
    } finally {
      setSaving(false);
    }
  };

  const toggleType = (t: MarketplacePackageType): void =>
    setBlockedTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <OpsPanel title="Organization marketplace policy" subtitle="Govern which packages your organization may install (RBAC: marketplace:manage)">
      <div className="max-w-2xl rounded-2xl border border-[var(--hairline)] p-4">
        <Toggle label="Require approval for every install" value={requireApproval} onChange={setRequireApproval} />
        <Toggle label="Require a valid signature" value={requireSignature} onChange={setRequireSignature} />
        <div className="flex items-center justify-between py-2">
          <span className="text-sm">Minimum publisher tier</span>
          <div className="flex gap-1">
            {PUBLISHER_TIERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setMinTier(t)}
                className={cn(
                  'rounded-lg border px-2 py-1 text-2xs transition',
                  minTier === t ? 'border-white/30 bg-white/[0.06] text-ink' : 'border-white/5 text-faint hover:border-white/15',
                )}
              >
                {tierLabel(t)}
              </button>
            ))}
          </div>
        </div>
        <div className="py-2">
          <div className="mb-1.5 text-sm">Blocked package types</div>
          <div className="flex flex-wrap gap-1">
            {MARKETPLACE_PACKAGE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-2xs transition',
                  blockedTypes.includes(t) ? 'border-white/30 bg-white/[0.08] text-white' : 'border-white/5 text-faint hover:border-white/15',
                )}
              >
                {typeLabel(t)}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-ink transition hover:bg-white/15 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save policy'}
          </button>
          {saved && <span className="text-xs text-muted">{saved}</span>}
        </div>
      </div>
    </OpsPanel>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex w-full items-center justify-between py-2 text-left">
      <span className="text-sm">{label}</span>
      <span className={cn('flex h-5 w-9 items-center rounded-full px-0.5 transition', value ? 'bg-white/30' : 'bg-white/10')}>
        <span className={cn('h-4 w-4 rounded-full bg-white transition', value ? 'translate-x-4' : '')} />
      </span>
    </button>
  );
}
