/**
 * Settings → AI — AI Mode, per-route status, measured usage, Privacy Center.
 *
 * Renders BESIDE the existing provider panel and reuses its infrastructure:
 * the existing provider system stays the single source of truth (this panel's
 * route list comes from the same candidate assembly the router builds from),
 * and every state shown is real — a probe, a stored config, or a measured
 * counter. Percentages appear only after the first measured run.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AiConfigDto, AiMode, AiRoutingStatusView, AiRoutingUsage } from '@neuropause/shared';
import {
  AI_MODES,
  AI_MODE_DESCRIPTIONS,
  AI_MODE_LABELS,
  PROCESSING_LOCATION_DESCRIPTIONS,
  PROCESSING_LOCATION_LABELS,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { economicsLine, usageDisplay } from '@renderer/firstRun/experienceModel';

const log = createLogger('ai-routing-settings');

const STATE_LABELS: Record<string, { text: string; cls: string }> = {
  connected: { text: 'Connected', cls: 'text-emerald-400' },
  not_configured: { text: 'Not configured', cls: 'text-faint' },
  disabled: { text: 'Disabled', cls: 'text-amber-400' },
  unreachable: { text: 'Unreachable', cls: 'text-amber-400' },
};

export function AiRoutingPanel(): JSX.Element {
  const [routing, setRouting] = useState<AiRoutingStatusView | null>(null);
  const [usage, setUsage] = useState<AiRoutingUsage | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setRouting(await ipc.aiConfig.routingStatus());
      setUsage(await ipc.aiConfig.routingUsage());
    } catch (err) {
      log.warn('Routing status unavailable', err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setMode = async (mode: AiMode): Promise<void> => {
    setBusy(true);
    try {
      const next: AiConfigDto = await ipc.aiConfig.setMode(mode);
      void next;
      await refresh();
    } catch (err) {
      log.warn('Could not set AI mode', err);
    } finally {
      setBusy(false);
    }
  };

  const setConsent = async (consent: boolean): Promise<void> => {
    setBusy(true);
    try {
      await ipc.aiConfig.setExternalConsent(consent);
      await refresh();
    } catch (err) {
      log.warn('Could not set consent', err);
    } finally {
      setBusy(false);
    }
  };

  const usageView = usageDisplay(usage);

  return (
    <div className="space-y-4">
      {/* ── AI Mode ── */}
      <section aria-label="AI mode">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">AI Mode</h3>
        <div className="space-y-1.5" role="radiogroup" aria-label="AI mode">
          {AI_MODES.map((mode) => (
            <label
              key={mode}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition ${
                routing?.mode === mode ? 'border-accent/60 bg-accent/10' : 'border-[var(--hairline)] hover:bg-white/5'
              }`}
            >
              <input
                type="radio"
                name="ai-mode"
                className="mt-0.5"
                checked={routing?.mode === mode}
                disabled={busy || !routing}
                onChange={() => void setMode(mode)}
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium">{AI_MODE_LABELS[mode]}</span>
                <span className="block text-2xs leading-relaxed text-faint">{AI_MODE_DESCRIPTIONS[mode]}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="mt-2 flex items-start gap-2.5 px-1 text-2xs text-muted">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={routing?.externalConsent ?? false}
            disabled={busy || !routing || routing.mode === 'local_only'}
            onChange={(e) => void setConsent(e.target.checked)}
          />
          <span>
            Allow an enabled external provider as a <strong>fallback</strong> when no local or private route can
            serve a request. Off means a request that needs a model and finds none fails on this device.
            {routing?.mode === 'local_only' && ' (Local Only mode never uses external providers, regardless.)'}
          </span>
        </label>
      </section>

      {/* ── Routes ── */}
      <section aria-label="AI routes">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">Routes</h3>
        <div className="space-y-1.5">
          {(routing?.routes ?? []).map((route) => {
            const state = STATE_LABELS[route.state] ?? { text: route.state, cls: 'text-faint' };
            return (
              <div
                key={`${route.provider}-${route.location}`}
                className="rounded-lg border border-[var(--hairline)] px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium">
                    {route.label}
                    <span className="ml-2 text-2xs font-normal text-faint">
                      {PROCESSING_LOCATION_LABELS[route.location]}
                      {route.model ? ` · ${route.model}` : ''}
                      {route.endpoint ? ` · ${route.endpoint}` : ''}
                    </span>
                  </span>
                  <span className={`text-2xs font-medium ${state.cls}`}>{state.text}</span>
                </div>
                <p className="mt-0.5 text-2xs text-faint">{route.detail}</p>
              </div>
            );
          })}
        </div>
        {routing && !routing.plan.ok && (
          <p className="mt-2 rounded-lg border border-amber-400/25 px-3 py-2 text-2xs leading-relaxed text-amber-400">
            {routing.plan.refusal}
          </p>
        )}
      </section>

      {/* ── AI Usage (measured) ── */}
      <section aria-label="AI usage">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">AI Usage</h3>
        {usageView.rows === null ? (
          <p className="text-2xs text-faint">{usageView.emptyMessage}</p>
        ) : (
          <div className="space-y-1">
            {usageView.rows.map((row) => (
              <div key={row.location} className="flex items-center gap-2 text-2xs">
                <span className="w-40 shrink-0 text-muted">{row.label}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full [background:var(--fill-2)]">
                  <span className="block h-full rounded-full bg-accent/70" style={{ width: `${row.pct}%` }} />
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted">
                  {row.pct}% · {row.count}
                </span>
              </div>
            ))}
            <p className="pt-1 text-2xs text-faint">
              Measured over {usageView.total} intelligence request{usageView.total === 1 ? '' : 's'} on this
              install (AI runs plus answers that needed no model). Counts come from actual execution metadata —
              nothing here is estimated.
            </p>
            {economicsLine(usage) && (
              <p className="pt-0.5 text-2xs font-medium text-sysgreen">{economicsLine(usage)}</p>
            )}
          </div>
        )}
      </section>

      {/* ── Privacy Center ── */}
      <section aria-label="Privacy">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">
          Where your AI processing happens
        </h3>
        <div className="space-y-1.5 text-2xs leading-relaxed text-muted">
          <p>
            <strong className="text-ink">{PROCESSING_LOCATION_LABELS.local}.</strong>{' '}
            {PROCESSING_LOCATION_DESCRIPTIONS.local} Used whenever a local model server (such as Ollama) is
            reachable and your mode prefers it. You control it entirely: it is software running on this computer.
          </p>
          <p>
            <strong className="text-ink">{PROCESSING_LOCATION_LABELS.private_infrastructure}.</strong>{' '}
            {PROCESSING_LOCATION_DESCRIPTIONS.private_infrastructure} Used when your configured endpoint points at
            a machine other than this one. You control that infrastructure and where it runs.
          </p>
          <p>
            <strong className="text-ink">{PROCESSING_LOCATION_LABELS.external}.</strong>{' '}
            {PROCESSING_LOCATION_DESCRIPTIONS.external} Used only when you have configured a provider key and
            enabled external processing (or chosen External mode). Prompt content for those requests is sent to
            that provider; their terms govern their handling of it.
          </p>
          <p className="text-faint">
            Every AI response carries a badge stating which of these actually served it, with a &ldquo;Why?&rdquo;
            explanation derived from the execution — not from this settings page. Deterministic answers that run no
            model are computed on this device and labelled accordingly.
          </p>
        </div>
      </section>
    </div>
  );
}
