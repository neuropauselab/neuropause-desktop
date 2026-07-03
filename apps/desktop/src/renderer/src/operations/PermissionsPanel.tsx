import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PermissionGrant, PermissionState, RuntimePermissionKey } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { formatRelative } from '@renderer/lib/format';
import { useOperations } from './OperationsProvider';
import { OpsPanel, StatusDot } from './primitives';
import { glyphFor, permStateMeta, toneFor } from './lib';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';

interface Capability {
  id: string;
  label: string;
  icon: IconName;
  desc: string;
  keys: RuntimePermissionKey[];
}

const CAPS: Capability[] = [
  { id: 'filesystem', label: 'Filesystem', icon: 'folder', desc: 'Read and write files on disk', keys: ['filesystem_read', 'filesystem_write'] },
  { id: 'network', label: 'Network', icon: 'globe', desc: 'Make outbound connections', keys: ['network'] },
  { id: 'clipboard', label: 'Clipboard', icon: 'clipboard', desc: 'Read and write the clipboard', keys: ['clipboard'] },
  { id: 'notifications', label: 'Notifications', icon: 'bell', desc: 'Post system notifications', keys: ['notifications'] },
  { id: 'camera', label: 'Camera', icon: 'camera', desc: 'Capture from the camera', keys: ['camera'] },
  { id: 'microphone', label: 'Microphone', icon: 'mic', desc: 'Capture from the microphone', keys: ['microphone'] },
  { id: 'automation', label: 'Automation', icon: 'automations', desc: 'Drive other applications', keys: ['automation'] },
  { id: 'background', label: 'Background Services', icon: 'pulse', desc: 'Run work in the background', keys: ['background'] },
  { id: 'local_models', label: 'Local AI Models', icon: 'cpu', desc: 'Access on-device models', keys: ['local_models'] },
  { id: 'shell', label: 'Shell Execution', icon: 'code', desc: 'Execute shell commands', keys: ['shell_execution'] },
];

interface Row {
  slug: string;
  name: string;
  permission: RuntimePermissionKey;
  state: PermissionState;
  decidedAt: string | null;
}

/**
 * Permission Center — every capability granted to installed apps, grouped and
 * revocable. Grants are read per app from the Permission service; toggling
 * applies immediately and is recorded in the audit trail (the Activity Log).
 */
export function PermissionsPanel(): JSX.Element {
  const { registry, logEntries, appendLog } = useOperations();
  const [permsBySlug, setPermsBySlug] = useState<Record<string, PermissionGrant[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const map: Record<string, PermissionGrant[]> = {};
    await Promise.all(
      registry.map(async (app) => {
        try {
          map[app.slug] = await ipc.perms.list(app.slug);
        } catch {
          map[app.slug] = [];
        }
      }),
    );
    setPermsBySlug(map);
  }, [registry]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameFor = useCallback((slug: string): string => registry.find((r) => r.slug === slug)?.name ?? slug, [registry]);

  // Flatten all grants into per-capability rows.
  const rowsByCap = useMemo(() => {
    const out: Record<string, Row[]> = {};
    for (const cap of CAPS) out[cap.id] = [];
    for (const [slug, grants] of Object.entries(permsBySlug)) {
      for (const g of grants) {
        const cap = CAPS.find((c) => c.keys.includes(g.permission));
        if (cap) out[cap.id].push({ slug, name: nameFor(slug), permission: g.permission, state: g.state, decidedAt: g.decidedAt });
      }
    }
    return out;
  }, [permsBySlug, nameFor]);

  const toggle = async (slug: string, permission: RuntimePermissionKey, granted: boolean): Promise<void> => {
    try {
      const next = granted ? await ipc.perms.revoke(slug, permission) : await ipc.perms.grant(slug, permission);
      setPermsBySlug((prev) => ({ ...prev, [slug]: next }));
      appendLog({ source: 'permission', kind: granted ? 'revoke' : 'grant', title: `${granted ? 'Revoked' : 'Granted'} ${permission} · ${nameFor(slug)}`, detail: null, tone: granted ? 'orange' : 'green' });
    } catch (err) {
      appendLog({ source: 'permission', kind: 'error', title: `Permission change failed · ${nameFor(slug)}`, detail: (err as Error).message, tone: 'red' });
    }
  };

  const auditTrail = useMemo(() => logEntries.filter((e) => e.source === 'permission').slice(0, 12), [logEntries]);

  const countState = (rows: Row[], state: PermissionState): number => rows.filter((r) => r.state === state).length;

  return (
    <div>
      <OpsPanel title="Permission Center" subtitle="Capabilities granted to installed applications">
        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
          {CAPS.map((cap, idx) => {
            const rows = rowsByCap[cap.id];
            const granted = countState(rows, 'granted');
            const denied = countState(rows, 'denied');
            const revoked = countState(rows, 'revoked');
            const isOpen = expanded === cap.id;
            return (
              <div key={cap.id} className={cn(idx > 0 && 'border-t border-[var(--hairline)]')}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : cap.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition fill-hover"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg [background:var(--fill-2)] text-muted"><Icon name={cap.icon} size={17} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{cap.label}</div>
                    <div className="text-2xs text-faint">{cap.desc}</div>
                  </div>
                  <div className="flex items-center gap-2.5 text-2xs">
                    {granted > 0 && <Count tone="green" n={granted} label="granted" />}
                    {denied > 0 && <Count tone="red" n={denied} label="denied" />}
                    {revoked > 0 && <Count tone="orange" n={revoked} label="revoked" />}
                    {rows.length === 0 && <span className="text-faint">No apps</span>}
                  </div>
                  <Icon name="chevron-down" size={15} className={cn('text-faint transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-3 [background:var(--fill-1)]">
                    {rows.length === 0 ? (
                      <p className="py-2 text-xs text-faint">No installed app requests this capability.</p>
                    ) : (
                      rows.map((r) => {
                        const meta = permStateMeta(r.state);
                        const isGranted = r.state === 'granted';
                        return (
                          <div key={`${r.slug}:${r.permission}`} className="flex items-center gap-3 py-2">
                            <AppGlyph glyph={glyphFor(r.name)} tone={toneFor(r.slug)} size={24} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">{r.name}</div>
                              <div className="text-2xs text-faint">{r.permission}{r.decidedAt && ` · ${formatRelative(r.decidedAt)}`}</div>
                            </div>
                            <span className="inline-flex items-center gap-1.5"><StatusDot tone={meta.tone} /><span className="text-2xs text-faint">{meta.label}</span></span>
                            <button
                              type="button"
                              onClick={() => void toggle(r.slug, r.permission, isGranted)}
                              className={cn('rounded-lg px-2 py-1 text-2xs font-medium transition', isGranted ? 'text-syspink fill-hover' : 'text-sysgreen fill-hover')}
                            >
                              {isGranted ? 'Revoke' : 'Grant'}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {registry.length === 0 && (
          <p className="mt-3 text-2xs text-faint">Install an app to manage its capabilities here. Plugin permissions are managed in the Plugin Manager.</p>
        )}
      </OpsPanel>

      <OpsPanel title="Audit history" subtitle="Recent permission changes this session">
        {auditTrail.length === 0 ? (
          <p className="surface-raised rounded-2xl px-4 py-6 text-center text-sm text-faint shadow-card">No permission changes recorded yet.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--hairline)]">
            {auditTrail.map((e, idx) => (
              <div key={e.id} className={cn('flex items-center gap-3 px-4 py-2.5', idx > 0 && 'border-t border-[var(--hairline)]')}>
                <StatusDot tone={e.tone} />
                <span className="flex-1 truncate text-sm">{e.title}</span>
                <span className="tabular-nums text-2xs text-faint">{formatRelative(e.at)}</span>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

function Count({ tone, n, label }: { tone: 'green' | 'red' | 'orange'; n: number; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      <StatusDot tone={tone} />
      <span className="tabular-nums text-muted">{n}</span>
      <span className="text-faint">{label}</span>
    </span>
  );
}
