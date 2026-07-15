/**
 * P8.6 — Install Manager. Lists installed worker packages (virtualized) and drives their
 * lifecycle — enable / disable / rollback / uninstall — through the P8.5 install service.
 * Every action is RBAC-gated (workforce:manage) SERVER-side; the UI reports the structured
 * result (or a rejection for an unauthorized caller) and refreshes. Selecting a package
 * shows its full detail: signature, checksum, engine range, execution bindings, deps.
 */
import { useEffect, useRef, useState } from 'react';
import type { WorkerInstallDetail, WorkerInstallResult, WorkerInstallSummary } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OpsPanel } from '@renderer/operations/primitives';
import { EmptyState, Field, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { Pill, WorkerGlyph } from '@renderer/workforce/primitives';
import { relativeTime, titleCase } from '@renderer/workforce/lib';
import { useWorkforce } from '@renderer/workforce/WorkforceProvider';
import { VirtualList } from './VirtualList';
import { installActions } from './workforceCenterModel';

export function InstallManagerPanel(): JSX.Element {
  const { installs, loadInstallDetail, enableWorker, disableWorker, rollbackWorker, uninstallWorker } = useWorkforce();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkerInstallDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [detailNonce, setDetailNonce] = useState(0);
  const reqRef = useRef(0);

  // Auto-select, and reconcile a dangling selection (e.g. after uninstall) to the next
  // package (or clear when none remain). Runs on the installs list changing.
  useEffect(() => {
    if (installs.length === 0) {
      if (selectedId !== null) setSelectedId(null);
    } else if (!selectedId || !installs.some((i) => i.id === selectedId)) {
      setSelectedId(installs[0].id);
    }
  }, [installs, selectedId]);

  // Reset the two-click confirm whenever the selection changes.
  useEffect(() => {
    setConfirmUninstall(false);
  }, [selectedId]);

  // Load detail for the selected package — independent of background refreshes (so a
  // live event never wipes the notice/confirm). `detailNonce` refetches after an action.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const req = ++reqRef.current;
    setLoading(true);
    void (async () => {
      const d = await loadInstallDetail(selectedId);
      if (req !== reqRef.current) return;
      setDetail(d);
      setLoading(false);
    })();
  }, [selectedId, loadInstallDetail, detailNonce]);

  const selected = installs.find((i) => i.id === selectedId) ?? null;

  const select = (id: string): void => {
    setNotice(null);
    setSelectedId(id);
  };

  const act = async (fn: () => Promise<WorkerInstallResult>, label: string): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fn();
      setNotice(r.ok ? { tone: 'ok', text: `${label} succeeded.` } : { tone: 'err', text: r.errors[0] ?? `${label} failed.` });
      if (r.ok) setDetailNonce((n) => n + 1);
    } catch {
      setNotice({ tone: 'err', text: `${label} not permitted (requires workforce:manage).` });
    } finally {
      setBusy(false);
      setConfirmUninstall(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
      <OpsPanel title={`Installed packages · ${installs.length}`} className="mb-0">
        {installs.length === 0 ? (
          <EmptyState icon="package" title="No installed packages" hint="Built-in workers are always available. Installed worker packages appear here." />
        ) : (
          <VirtualList
            items={installs}
            rowHeight={64}
            height={Math.min(600, Math.max(128, installs.length * 64))}
            rowKey={(i) => i.id}
            renderRow={(i) => <InstallRow item={i} active={i.id === selectedId} onSelect={() => select(i.id)} />}
          />
        )}
      </OpsPanel>

      <div>
        {notice && (
          <div
            className={cn(
              'mb-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs',
              notice.tone === 'ok' ? 'border-white/15 text-white/80' : 'border-white/25 text-white',
            )}
          >
            <Icon name={notice.tone === 'ok' ? 'check' : 'info'} size={14} />
            {notice.text}
          </div>
        )}
        {loading && !detail ? (
          <LoadingBlock label="Loading package…" />
        ) : selected ? (
          <div>
            <div className="mb-4 flex items-start gap-3.5 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
              <WorkerGlyph role={selected.role} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-lg font-semibold tracking-tight">{selected.name}</h3>
                  <Pill tone={selected.state === 'enabled' ? 'green' : 'gray'}>{selected.state}</Pill>
                  {detail?.signed && <Pill tone="blue" icon="verified">signed</Pill>}
                </div>
                <div className="mt-0.5 text-xs text-faint">
                  {titleCase(selected.role)} · v{selected.version} · {selected.author}
                </div>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              {installActions(selected).canEnable && (
                <ActionButton icon="play" label="Enable" disabled={busy} onClick={() => void act(() => enableWorker(selected.id), 'Enable')} />
              )}
              {installActions(selected).canDisable && (
                <ActionButton icon="pause" label="Disable" disabled={busy} onClick={() => void act(() => disableWorker(selected.id), 'Disable')} />
              )}
              {installActions(selected).canRollback && (
                <ActionButton
                  icon="undo"
                  label={detail?.previousVersion ? `Roll back to v${detail.previousVersion}` : 'Roll back'}
                  disabled={busy}
                  onClick={() => void act(() => rollbackWorker(selected.id), 'Rollback')}
                />
              )}
              <ActionButton
                icon="trash"
                label={confirmUninstall ? 'Confirm uninstall' : 'Uninstall'}
                tone="danger"
                disabled={busy}
                onClick={() => (confirmUninstall ? void act(() => uninstallWorker(selected.id), 'Uninstall') : setConfirmUninstall(true))}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-[var(--hairline)] p-4">
                <div className="mb-1.5 text-xs font-semibold tracking-tight">Package</div>
                <Field label="Version" value={selected.version} />
                <Field label="Publisher" value={selected.author} />
                <Field label="Signature" value={detail?.signed ? `verified · ${detail.signatureKeyId ?? ''}` : 'unsigned'} />
                <Field label="Checksum" value={detail ? `${detail.checksum.slice(0, 16)}…` : '—'} />
                <Field label="Engine" value={detail?.engine.neuropause ?? '—'} />
                <Field label="Rollback to" value={detail?.previousVersion ? `v${detail.previousVersion}` : 'none'} />
                <Field label="Updated" value={relativeTime(selected.updatedAt)} />
              </div>

              <div className="rounded-2xl border border-[var(--hairline)] p-4">
                <div className="mb-1.5 text-xs font-semibold tracking-tight">Skills & bindings</div>
                {detail && detail.skills.length > 0 ? (
                  <div className="flex flex-col gap-1.5 py-1">
                    {detail.skills.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 rounded-lg border border-white/5 px-2.5 py-1.5">
                        <Icon name={s.kind === 'infra' ? 'server' : s.kind === 'mail' ? 'connectors' : 'eye'} size={13} className="text-muted" />
                        <span className="text-xs font-medium">{s.id}</span>
                        <span className="ml-auto text-2xs text-faint">
                          {s.kind}
                          {s.target ? ` · ${s.target}` : ''}
                          {s.actionId ? ` · ${s.actionId}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-1 text-xs text-faint">No skill detail.</p>
                )}
                {detail && detail.dependencies.length > 0 && (
                  <div className="mt-2">
                    <div className="mb-1 text-2xs uppercase tracking-wide text-faint">Dependencies</div>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.dependencies.map((d) => (
                        <Pill key={d} tone="gray" icon="package">{d}</Pill>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState icon="package" title="Select a package" hint="Choose an installed worker package to manage its lifecycle." />
        )}
      </div>
    </div>
  );
}

function InstallRow({ item, active, onSelect }: { item: WorkerInstallSummary; active: boolean; onSelect: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex h-[60px] w-full items-center gap-2.5 rounded-xl border px-2.5 text-left transition',
        active ? 'border-white/30 bg-white/[0.05]' : 'border-white/5 hover:border-white/15',
      )}
    >
      <WorkerGlyph role={item.role} size={30} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{item.name}</div>
        <div className="truncate text-2xs text-faint">v{item.version} · {item.author}</div>
      </div>
      <Pill tone={item.state === 'enabled' ? 'green' : 'gray'}>{item.state}</Pill>
    </button>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  tone = 'default',
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:pointer-events-none disabled:opacity-40',
        tone === 'danger'
          ? 'border-white/25 text-white hover:bg-white/10'
          : 'border-white/10 text-muted hover:border-white/20 hover:text-ink',
      )}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}
