import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, UpdateCheck } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { prefs, PrefKey } from '@renderer/lib/preferences';
import { useOperations } from './OperationsProvider';
import { OpsPanel, IconAction, StatusBadge } from './primitives';
import { glyphFor, toneFor } from './lib';

type Channel = 'stable' | 'beta' | 'nightly';
const CHANNELS: { id: Channel; label: string; icon: IconName }[] = [
  { id: 'stable', label: 'Stable', icon: 'shield' },
  { id: 'beta', label: 'Beta', icon: 'beaker' },
  { id: 'nightly', label: 'Nightly', icon: 'moon' },
];

/**
 * Update Center — unified update management across applications, plugins, and
 * the platform. App update checks are live (Catalog); applying an update runs
 * the Package Service with rollback support. Desktop/runtime self-update is a
 * managed status surface pending the Phase-4 updater.
 */
export function UpdatesPanel(): JSX.Element {
  const { registry, plugins, appendLog, refreshRegistry, pluginUpdate } = useOperations();
  const [channel, setChannel] = useState<Channel>(() => prefs.read<Channel>(PrefKey.updateChannel, 'stable'));
  const [autoUpdate, setAutoUpdate] = useState<boolean>(() => prefs.read<boolean>(PrefKey.autoUpdate, true));
  const [ignored, setIgnored] = useState<Record<string, string>>(() => prefs.read<Record<string, string>>(PrefKey.ignoredVersions, {}));
  const [updates, setUpdates] = useState<UpdateCheck[]>([]);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const info = await ipc.app.getInfo();
      setAppInfo(info);
    } catch {
      /* ignore */
    }
    const found: UpdateCheck[] = [];
    await Promise.all(
      registry.map(async (app) => {
        try {
          const u = await ipc.catalog.checkUpdate(app.slug);
          if (u.updateAvailable && ignored[app.slug] !== u.latestVersion) found.push(u);
        } catch {
          /* skip */
        }
      }),
    );
    setUpdates(found);
    setChecking(false);
  }, [registry, ignored]);

  useEffect(() => {
    void check();
  }, [check]);

  const setChannelPref = (c: Channel): void => {
    setChannel(c);
    prefs.write(PrefKey.updateChannel, c);
  };
  const toggleAuto = (): void => {
    const next = !autoUpdate;
    setAutoUpdate(next);
    prefs.write(PrefKey.autoUpdate, next);
  };

  const applyUpdate = async (slug: string, name: string): Promise<void> => {
    setBusy(slug);
    try {
      const res = await ipc.nps.update(slug);
      appendLog({ source: 'registry', kind: 'update', title: res.ok ? `Updated ${name}` : `Update failed: ${name}`, detail: res.message, tone: res.ok ? 'green' : 'red' });
    } catch (err) {
      appendLog({ source: 'registry', kind: 'update', title: `Update failed: ${name}`, detail: (err as Error).message, tone: 'red' });
    }
    setBusy(null);
    void refreshRegistry();
    void check();
  };

  const rollback = async (slug: string, name: string): Promise<void> => {
    try {
      const res = await ipc.nps.rollback(slug);
      appendLog({ source: 'registry', kind: 'rollback', title: res.ok ? `Rolled back ${name}` : `Rollback failed: ${name}`, detail: res.message, tone: res.ok ? 'orange' : 'red' });
    } catch (err) {
      appendLog({ source: 'registry', kind: 'rollback', title: `Rollback failed: ${name}`, detail: (err as Error).message, tone: 'red' });
    }
    void refreshRegistry();
  };

  const ignore = (slug: string, version: string | null): void => {
    if (!version) return;
    const next = { ...ignored, [slug]: version };
    setIgnored(next);
    prefs.write(PrefKey.ignoredVersions, next);
    setUpdates((prev) => prev.filter((u) => u.appSlug !== slug));
  };

  const updateAll = async (): Promise<void> => {
    for (const u of updates) {
      const app = registry.find((r) => r.slug === u.appSlug);
      // eslint-disable-next-line no-await-in-loop
      await applyUpdate(u.appSlug, app?.name ?? u.appSlug);
    }
  };

  const nameFor = (slug: string): string => registry.find((r) => r.slug === slug)?.name ?? slug;

  return (
    <div>
      <OpsPanel
        title="Update Center"
        subtitle="Applications, plugins, and platform"
        actions={
          <>
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => void check()} disabled={checking}>
              {checking ? 'Checking…' : 'Check'}
            </Button>
            {updates.length > 0 && (
              <Button size="sm" variant="primary" icon="arrow-up" onClick={() => void updateAll()}>
                Update all ({updates.length})
              </Button>
            )}
          </>
        }
      >
        {/* Release channel + automatic updates */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--hairline)] px-4 py-3 [background:var(--fill-1)]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-faint">Channel</span>
            <div className="flex gap-1">
              {CHANNELS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChannelPref(c.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition',
                    channel === c.id ? 'surface-raised text-ink shadow-sm' : 'text-muted hover:text-ink',
                  )}
                >
                  <Icon name={c.icon} size={13} /> {c.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleAuto}
            className="inline-flex items-center gap-2 text-xs font-medium text-muted hover:text-ink"
          >
            <span className={cn('flex h-4 w-7 items-center rounded-full p-0.5 transition', autoUpdate ? 'bg-accent' : '[background:var(--fill-2)]')}>
              <span className={cn('h-3 w-3 rounded-full bg-white transition-transform', autoUpdate && 'translate-x-3')} />
            </span>
            Automatic updates
          </button>
        </div>

        {/* Application updates */}
        {updates.length === 0 ? (
          <div className="surface-raised flex items-center gap-2 rounded-2xl px-4 py-4 shadow-card">
            <Icon name="check" size={18} className="text-sysgreen" />
            <span className="text-sm font-medium">{registry.length === 0 ? 'No applications installed' : 'All applications are up to date'}</span>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
            {updates.map((u, idx) => (
              <div key={u.appSlug} className={cn('flex items-center gap-3 px-4 py-3', idx > 0 && 'border-t border-[var(--hairline)]')}>
                <AppGlyph glyph={glyphFor(nameFor(u.appSlug))} tone={toneFor(u.appSlug)} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{nameFor(u.appSlug)}</div>
                  <div className="text-2xs text-faint">
                    {u.installedVersion ?? '—'} → <span className="text-sysgreen">{u.latestVersion ?? 'latest'}</span>
                    {u.releaseId && <span className="ml-1.5 text-faint">· {u.releaseId}</span>}
                  </div>
                </div>
                <Button size="sm" variant="primary" onClick={() => void applyUpdate(u.appSlug, nameFor(u.appSlug))} disabled={busy === u.appSlug}>
                  {busy === u.appSlug ? 'Updating…' : 'Update'}
                </Button>
                <IconAction icon="undo" label="Rollback" onClick={() => void rollback(u.appSlug, nameFor(u.appSlug))} />
                <IconAction icon="close" label="Ignore this version" onClick={() => ignore(u.appSlug, u.latestVersion)} />
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      {/* Plugins */}
      {plugins.length > 0 && (
        <OpsPanel title="Plugin updates" subtitle="Managed by the Plugin Host">
          <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
            {plugins.map((p, idx) => (
              <div key={p.id} className={cn('flex items-center gap-3 px-4 py-3', idx > 0 && 'border-t border-[var(--hairline)]')}>
                <AppGlyph glyph={glyphFor(p.name)} tone={toneFor(p.id)} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-2xs text-faint">v{p.version}</div>
                </div>
                <Button size="sm" variant="secondary" icon="arrow-up" onClick={() => void pluginUpdate(p.id, p.name)}>Update</Button>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {/* Platform */}
      <OpsPanel title="Platform" subtitle="Desktop, runtime, and connector packages">
        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
          <PlatformRow icon="package" name="NeuroPause Desktop" detail={appInfo ? `v${appInfo.version}` : 'Loading…'} tone="green" status="Up to date" />
          <PlatformRow icon="cpu" name="Runtime" detail="Bundled with desktop" tone="green" status="Up to date" />
          <PlatformRow icon="connectors" name="Connector packages" detail="Connector Framework" tone="gray" status="Phase 4" />
        </div>
        <p className="mt-3 text-2xs text-faint">
          {autoUpdate ? 'Automatic checks run in the background every 6 hours.' : 'Automatic checks are off — use Check to refresh.'}
        </p>
      </OpsPanel>
    </div>
  );
}

function PlatformRow({ icon, name, detail, tone, status }: { icon: IconName; name: string; detail: string; tone: 'green' | 'gray'; status: string }): JSX.Element {
  return (
    <div className="flex items-center gap-3 border-t border-[var(--hairline)] px-4 py-3 first:border-t-0">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg [background:var(--fill-2)] text-muted"><Icon name={icon} size={17} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{name}</div>
        <div className="text-2xs text-faint">{detail}</div>
      </div>
      <StatusBadge tone={tone} label={status} />
    </div>
  );
}
