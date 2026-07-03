import { Fragment, useState } from 'react';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { formatRelative } from '@renderer/lib/format';
import { useShell } from '@renderer/state/ShellProvider';
import { useOperations } from './OperationsProvider';
import { OpsPanel, OpsTable, IconAction, StatusBadge } from './primitives';
import { adapterLabel, formatBytes, glyphFor, runtimeStatusMeta, toneFor } from './lib';

/** Installed Applications — the Local Registry inventory with management actions. */
export function InstalledPanel(): JSX.Element {
  const { setSection } = useShell();
  const { registry, runtimeLaunch, appUninstall, appVerify, appRepair, setFlags } = useOperations();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  if (registry.length === 0) {
    return (
      <OpsPanel title="Installed Applications" subtitle="Apps in your Local Registry">
        <div className="surface-raised rounded-2xl shadow-card">
          <EmptyState
            icon="package"
            title="Nothing installed yet"
            description="Install an app from the AI Store and it will appear here."
            action={
              <Button variant="primary" icon="store" onClick={() => setSection('store')}>
                Open AI Store
              </Button>
            }
          />
        </div>
      </OpsPanel>
    );
  }

  return (
    <OpsPanel title="Installed Applications" subtitle={`${registry.length} installed`}>
      <OpsTable
        head={
          <>
            <th className="py-2.5 pl-4 pr-3 font-semibold">Application</th>
            <th className="px-3 py-2.5 font-semibold">Version</th>
            <th className="px-3 py-2.5 font-semibold">Disk</th>
            <th className="px-3 py-2.5 font-semibold">Launches</th>
            <th className="px-3 py-2.5 font-semibold">Last launch</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="py-2.5 pl-3 pr-4 text-right font-semibold">Actions</th>
          </>
        }
      >
        {registry.map((app) => {
          const status = runtimeStatusMeta(app.runtimeStatus);
          const isOpen = expanded === app.slug;
          const isConfirming = confirm === app.slug;
          return (
            <Fragment key={app.slug}>
              <tr
                className="cursor-pointer border-t border-[var(--hairline)] align-middle fill-hover"
                onClick={() => setExpanded(isOpen ? null : app.slug)}
              >
                <td className="py-2.5 pl-4 pr-3">
                  <div className="flex items-center gap-2.5">
                    <AppGlyph glyph={glyphFor(app.name)} tone={toneFor(app.slug)} size={30} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{app.name}</span>
                        {app.favorite && <Icon name="star-fill" size={12} className="text-sysyellow" />}
                        {app.pinned && <Icon name="pin" size={12} className="text-accent" />}
                      </div>
                      <div className="text-2xs text-faint">{adapterLabel(app.appType)}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-muted">
                  <span className="tabular-nums">{app.installedVersion ?? '—'}</span>
                  <span className="ml-1.5 rounded [background:var(--fill-2)] px-1.5 py-0.5 text-2xs uppercase tracking-wide text-faint">
                    {app.channel}
                  </span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-muted">{formatBytes(app.diskUsageBytes)}</td>
                <td className="px-3 py-2.5 tabular-nums text-muted">{app.launchCount}</td>
                <td className="px-3 py-2.5 text-muted">
                  {app.lastLaunchedAt ? formatRelative(app.lastLaunchedAt) : '—'}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge tone={status.tone} label={status.label} pulse={app.runtimeStatus === 'running'} />
                </td>
                <td className="py-2 pl-3 pr-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-0.5">
                    {isConfirming ? (
                      <>
                        <span className="mr-1 text-2xs font-medium text-syspink">Remove?</span>
                        <IconAction icon="check" label="Confirm uninstall" tone="red" onClick={() => { void appUninstall(app.slug, app.name); setConfirm(null); }} />
                        <IconAction icon="close" label="Cancel" onClick={() => setConfirm(null)} />
                      </>
                    ) : (
                      <>
                        <IconAction icon={app.favorite ? 'star-fill' : 'star'} label="Favorite" tone={app.favorite ? 'orange' : 'gray'} onClick={() => void setFlags(app.slug, { favorite: !app.favorite })} />
                        <IconAction icon="pin" label={app.pinned ? 'Unpin' : 'Pin'} tone={app.pinned ? 'accent' : 'gray'} onClick={() => void setFlags(app.slug, { pinned: !app.pinned })} />
                        <IconAction icon="launch" label="Launch" tone="green" onClick={() => void runtimeLaunch(app.slug, app.name)} />
                        <IconAction icon="shield" label="Verify integrity" onClick={() => void appVerify(app.slug, app.name)} />
                        <IconAction icon="refresh" label="Repair" onClick={() => void appRepair(app.slug, app.name)} />
                        <IconAction icon="trash" label="Uninstall" tone="red" onClick={() => setConfirm(app.slug)} />
                      </>
                    )}
                  </div>
                </td>
              </tr>
              {isOpen && (
                <tr className="border-t border-[var(--hairline)] [background:var(--fill-1)]">
                  <td colSpan={7} className="px-4 py-3">
                    <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                      <Detail label="Install location" value={app.installLocation ?? 'Managed'} mono />
                      <Detail label="Package hash" value={app.packageHash ? `${app.packageHash.slice(0, 18)}…` : '—'} mono />
                      <Detail label="Signature" value={app.hasSignature ? `Signed · ${app.signatureKeyId ?? 'key'}` : 'Unsigned'} />
                      <Detail label="Installed" value={formatRelative(app.installedAt)} />
                      <Detail label="Updated" value={app.lastUpdatedAt ? formatRelative(app.lastUpdatedAt) : '—'} />
                      <Detail label="Active time" value={`${Math.round(app.usage.totalActiveMs / 60000)} min`} />
                    </div>
                    {app.grantedPermissions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {app.grantedPermissions.map((p) => (
                          <span key={p} className="rounded-full [background:var(--fill-2)] px-2 py-0.5 text-2xs font-medium text-muted">
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </OpsTable>
    </OpsPanel>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-faint">{label}</span>
      <span className={mono ? 'font-mono text-2xs text-ink' : 'font-medium text-ink'}>{value}</span>
    </div>
  );
}
