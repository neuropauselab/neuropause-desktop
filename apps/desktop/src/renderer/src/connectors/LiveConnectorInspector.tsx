/**
 * P4.1 — the Live Connector Inspector. A self-contained panel for one connector that reads the runtime
 * inspection (runtime state + per-account scored health + recent lifecycle transitions) over
 * `ipc.connectors.inspect`, stays live off the `onLifecycle` broadcast, and exposes the operator controls
 * (pause/resume per account, disable/enable per connector) via `ipc.connectors.control`. Status/metrics
 * only — it never surfaces tokens. Reuses the existing design primitives; no new visual system.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  ConnectorControlAction,
  ConnectorInspection,
  ConnectorRuntimeState,
  IntegrationHealthState,
} from '@neuropause/shared';
import { runtimeStateLabel, runtimeStateSeverity } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { StatusBadge, IconAction } from '@renderer/operations/primitives';
import { DOT_BG, TEXT_TONE, type OpsTone } from '@renderer/operations/lib';
import { relativeTime } from './connectorLib';
import { serviceStatusMeta, summarizeServices } from './connectorCenterModel';

const RUNTIME_TONE: Record<ReturnType<typeof runtimeStateSeverity>, OpsTone> = {
  off: 'gray',
  idle: 'green',
  active: 'blue',
  warn: 'orange',
  error: 'red',
};
const HEALTH_TONE: Record<IntegrationHealthState, OpsTone> = {
  healthy: 'green',
  degraded: 'orange',
  unhealthy: 'red',
  idle: 'gray',
};

function runtimeTone(state: ConnectorRuntimeState): OpsTone {
  return RUNTIME_TONE[runtimeStateSeverity(state)];
}

function SectionTitle({ children }: { children: ReactNode }): JSX.Element {
  return <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">{children}</h3>;
}

export function LiveConnectorInspector({ connectorId }: { connectorId: string }): JSX.Element | null {
  const [data, setData] = useState<ConnectorInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await ipc.connectors.inspect(connectorId));
    } catch {
      setData(null);
    }
  }, [connectorId]);

  useEffect(() => {
    void load();
    const off = ipc.connectors.onLifecycle((e) => {
      if (e.connectorId !== connectorId) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), 160);
    });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      off();
    };
  }, [connectorId, load]);

  const act = useCallback(
    async (action: ConnectorControlAction, accountId?: string | null) => {
      setBusy(true);
      try {
        await ipc.connectors.control(connectorId, action, accountId ?? null);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [connectorId, load],
  );

  if (!data || data.accounts.length === 0) return null;

  const runtime = data.runtime;

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <SectionTitle>Runtime</SectionTitle>
        <div className="flex items-center gap-1.5">
          <StatusBadge tone={runtimeTone(runtime.state)} label={runtimeStateLabel(runtime.state)} pulse={runtimeStateSeverity(runtime.state) === 'active'} />
          <Button
            size="sm"
            variant="ghost"
            icon={runtime.disabled ? 'play' : 'pause'}
            disabled={busy}
            onClick={() => void act(runtime.disabled ? 'enable' : 'disable')}
          >
            {runtime.disabled ? 'Enable' : 'Disable'}
          </Button>
        </div>
      </div>

      {/* Per-account runtime + health + controls */}
      <div className="divide-y divide-[var(--hairline)] overflow-hidden rounded-xl border border-[var(--hairline)]">
        {data.accounts.map((a) => {
          const paused = a.control.paused;
          return (
            <div key={a.accountId} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={runtimeTone(a.state)} label={runtimeStateLabel(a.state)} pulse={runtimeStateSeverity(a.state) === 'active'} />
                  <span className={cn('text-2xs font-medium', TEXT_TONE[HEALTH_TONE[a.health.state]])}>
                    {a.health.score}/100 · {a.health.state}
                  </span>
                  {a.snapshot?.deadLettered && (
                    <span className="inline-flex items-center gap-1 rounded-md [background:rgb(var(--c-pink)/0.12)] px-1.5 py-0.5 text-2xs font-medium text-syspink">
                      <Icon name="info" size={11} /> Dead-lettered
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-2xs text-faint">
                  <span>{a.health.entityCount} synced</span>
                  {a.snapshot?.lastSyncAt && (
                    <>
                      <span>·</span>
                      <span>synced {relativeTime(a.snapshot.lastSyncAt)}</span>
                    </>
                  )}
                  {a.health.consecutiveFailures > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-sysorange">{a.health.consecutiveFailures} failures</span>
                    </>
                  )}
                  {a.snapshot && a.snapshot.queueSize > 0 && (
                    <>
                      <span>·</span>
                      <span>queue {a.snapshot.queueSize}</span>
                    </>
                  )}
                </div>
                {a.health.warnings.length > 0 && (
                  <div className="mt-0.5 truncate text-2xs text-faint">{a.health.warnings[0]}</div>
                )}
              </div>
              <IconAction
                icon={paused ? 'play' : 'pause'}
                label={paused ? 'Resume sync' : 'Pause sync'}
                tone={paused ? 'green' : 'gray'}
                disabled={busy || runtime.disabled}
                onClick={() => void act(paused ? 'resume' : 'pause', a.accountId)}
              />
            </div>
          );
        })}
      </div>

      {/* Services — the runtime-declared per-service capabilities (never hardcoded): the sync layer
          declares them (Google's scope catalog / an adapter's resources) and the Supervisor overlays
          the live per-module status. */}
      {data.services.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <SectionTitle>Services</SectionTitle>
            <span className="text-2xs text-faint">
              {summarizeServices(data.services).available}/{data.services.length} available
            </span>
          </div>
          <div className="divide-y divide-[var(--hairline)] overflow-hidden rounded-xl border border-[var(--hairline)]">
            {data.services.map((s) => {
              const meta = serviceStatusMeta(s.status);
              return (
                <div key={s.id} className="flex items-center gap-3 px-3.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{s.label}</span>
                      {s.kind && <span className="shrink-0 text-2xs text-faint">{s.kind}</span>}
                    </div>
                    {s.reason && s.status !== 'available' && (
                      <div className="mt-0.5 truncate text-2xs text-faint">{s.reason}</div>
                    )}
                  </div>
                  {typeof s.objectCount === 'number' && s.objectCount > 0 && (
                    <span className="shrink-0 text-2xs tabular-nums text-faint">{s.objectCount.toLocaleString()}</span>
                  )}
                  <StatusBadge tone={meta.tone} label={meta.label} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lifecycle trace */}
      {data.lifecycle.length > 0 && (
        <div className="mt-4">
          <SectionTitle>Lifecycle</SectionTitle>
          <div className="space-y-1.5">
            {data.lifecycle.slice(0, 8).map((e, i) => (
              <div key={`${e.at}-${i}`} className="flex items-center gap-2.5 text-2xs">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_BG[runtimeTone(e.to)])} />
                <span className="min-w-0 flex-1 truncate text-muted">
                  {runtimeStateLabel(e.from)} → <span className="font-medium text-ink">{runtimeStateLabel(e.to)}</span>
                  {e.reason ? ` · ${e.reason}` : ''}
                </span>
                <span className="shrink-0 tabular-nums text-faint">{relativeTime(e.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
