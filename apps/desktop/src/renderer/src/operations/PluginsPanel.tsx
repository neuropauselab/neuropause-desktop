import { Fragment, useState } from 'react';
import type { RuntimePermissionKey } from '@neuropause/shared';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { formatRelative } from '@renderer/lib/format';
import { useOperations } from './OperationsProvider';
import { OpsPanel, OpsTable, IconAction, StatusBadge } from './primitives';
import { glyphFor, healthMeta, pluginStateMeta, toneFor } from './lib';
import type { OpsTab } from './OperationsView';

/**
 * Plugin Manager — installed plugins with lifecycle controls, compatibility,
 * required permissions, and a manifest drawer. Plugins are loaded by the Plugin
 * Host (Stage 2 SDK); rollback uses the host's retained previous version.
 */
export function PluginsPanel({ onNavigate }: { onNavigate: (tab: OpsTab) => void }): JSX.Element {
  const { plugins, pluginEnable, pluginDisable, pluginReload, pluginUpdate, pluginRemove, pluginGrant, pluginRevoke } = useOperations();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  if (plugins.length === 0) {
    return (
      <OpsPanel title="Plugin Manager" subtitle="Sandboxed plugins loaded by the Plugin Host">
        <div className="surface-raised rounded-2xl shadow-card">
          <EmptyState
            icon="puzzle"
            title="No plugins installed"
            description="Plugins extend NeuroPause with background tasks, agents, and MCP servers. Installed plugins appear here with full lifecycle controls."
          />
        </div>
      </OpsPanel>
    );
  }

  return (
    <OpsPanel title="Plugin Manager" subtitle={`${plugins.length} installed · ${plugins.filter((p) => p.state === 'enabled').length} enabled`}>
      <OpsTable
        head={
          <>
            <th className="py-2.5 pl-4 pr-3 font-semibold">Plugin</th>
            <th className="px-3 py-2.5 font-semibold">Version</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold">Health</th>
            <th className="px-3 py-2.5 font-semibold">Compatibility</th>
            <th className="px-3 py-2.5 font-semibold">Permissions</th>
            <th className="py-2.5 pl-3 pr-4 text-right font-semibold">Actions</th>
          </>
        }
      >
        {plugins.map((p) => {
          const state = pluginStateMeta(p.state);
          const health = healthMeta(p.health);
          const isOpen = expanded === p.id;
          const isConfirming = confirm === p.id;
          const enabled = p.state === 'enabled';
          const ungranted = p.permissions.filter((k) => !p.grantedPermissions.includes(k));
          return (
            <Fragment key={p.id}>
              <tr className="cursor-pointer border-t border-[var(--hairline)] align-middle fill-hover" onClick={() => setExpanded(isOpen ? null : p.id)}>
                <td className="py-2.5 pl-4 pr-3">
                  <div className="flex items-center gap-2.5">
                    <AppGlyph glyph={glyphFor(p.name)} tone={toneFor(p.id)} size={30} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="text-2xs text-faint">{p.author ?? 'Unknown'} · {p.kind.replace('_', ' ')}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-muted">{p.version}</td>
                <td className="px-3 py-2.5"><StatusBadge tone={state.tone} label={state.label} pulse={enabled} /></td>
                <td className="px-3 py-2.5"><StatusBadge tone={health.tone} label={health.label} /></td>
                <td className="px-3 py-2.5">
                  {p.compatible ? (
                    <span className="inline-flex items-center gap-1 text-xs text-sysgreen"><Icon name="check" size={13} /> Compatible</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-syspink"><Icon name="info" size={13} /> Needs {p.engineRange}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted">
                  <span className="tabular-nums">{p.grantedPermissions.length}</span>
                  <span className="text-faint">/{p.permissions.length}</span>
                </td>
                <td className="py-2 pl-3 pr-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-0.5">
                    {isConfirming ? (
                      <>
                        <span className="mr-1 text-2xs font-medium text-syspink">Remove?</span>
                        <IconAction icon="check" label="Confirm uninstall" tone="red" onClick={() => { void pluginRemove(p.id, p.name); setConfirm(null); }} />
                        <IconAction icon="close" label="Cancel" onClick={() => setConfirm(null)} />
                      </>
                    ) : (
                      <>
                        {enabled
                          ? <IconAction icon="pause" label="Disable" tone="orange" onClick={() => void pluginDisable(p.id, p.name)} />
                          : <IconAction icon="play" label="Enable" tone="green" onClick={() => void pluginEnable(p.id, p.name)} />}
                        <IconAction icon="refresh" label="Reload" onClick={() => void pluginReload(p.id, p.name)} />
                        <IconAction icon="arrow-up" label="Update" tone="blue" onClick={() => void pluginUpdate(p.id, p.name)} />
                        <IconAction icon="list" label="View logs" onClick={() => onNavigate('logs')} />
                        <IconAction icon="trash" label="Uninstall" tone="red" onClick={() => setConfirm(p.id)} />
                      </>
                    )}
                  </div>
                </td>
              </tr>
              {isOpen && (
                <tr className="border-t border-[var(--hairline)] [background:var(--fill-1)]">
                  <td colSpan={7} className="px-4 py-3">
                    <div className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-faint">
                      <Icon name="eye" size={13} /> Manifest
                    </div>
                    <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                      <Detail label="Plugin ID" value={p.id} mono />
                      <Detail label="Engine range" value={p.engineRange} mono />
                      <Detail label="Kind" value={p.kind.replace('_', ' ')} />
                      <Detail label="Source" value={p.source} mono />
                      <Detail label="Installed" value={formatRelative(p.installedAt)} />
                      <Detail label="Updated" value={formatRelative(p.updatedAt)} />
                    </div>
                    {p.lastError && <p className="mt-2 text-xs text-syspink">Last error: {p.lastError}</p>}

                    {p.contributions.length > 0 && (
                      <div className="mt-3">
                        <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">Contributions</div>
                        <div className="flex flex-wrap gap-1.5">
                          {p.contributions.map((c) => (
                            <span key={c.id} className="rounded-full [background:var(--fill-2)] px-2 py-0.5 text-2xs text-muted">{c.surface}: {c.title}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-3">
                      <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">Required permissions</div>
                      <div className="flex flex-wrap gap-1.5">
                        {p.permissions.length === 0 && <span className="text-2xs text-faint">None requested</span>}
                        {p.grantedPermissions.map((k) => (
                          <PermChip key={k} k={k} granted onToggle={() => void pluginRevoke(p.id, p.name, k)} />
                        ))}
                        {ungranted.map((k) => (
                          <PermChip key={k} k={k} granted={false} onToggle={() => void pluginGrant(p.id, p.name, k)} />
                        ))}
                      </div>
                    </div>
                    <p className="mt-3 text-2xs text-faint">Rollback restores the Plugin Host&apos;s retained previous version when an update regresses.</p>
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

function PermChip({ k, granted, onToggle }: { k: RuntimePermissionKey; granted: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium transition ${granted ? 'bg-sysgreen/15 text-sysgreen' : '[background:var(--fill-2)] text-faint'}`}
      title={granted ? 'Revoke' : 'Grant'}
    >
      <Icon name={granted ? 'check' : 'plus'} size={11} />
      {k}
    </button>
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
