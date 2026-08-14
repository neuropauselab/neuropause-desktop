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
import type {
  AiConfigDto,
  AiMode,
  AiRoutingStatusView,
  AiRoutingUsage,
  TenantAiMode,
  TenantAiPreferenceView,
} from '@neuropause/shared';
import {
  AI_MODES,
  AI_MODE_DESCRIPTIONS,
  AI_MODE_LABELS,
  TENANT_AI_MODES,
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
  /**
   * THE SAME DEFECT AS THE D-5 HIGH, ON A DIFFERENT SCREEN. P13C ROUND 17h.
   *
   * `ai:config.setMode` is `cloud:operate` — platform-only, and refused on any
   * install with no platform operator, which is every fresh one. All three
   * calls below caught that refusal into `log.warn` and showed nothing. The
   * radios are CONTROLLED by `routing.mode`, and `refresh()` never runs after a
   * failure, so React puts the selection straight back: the control visibly
   * un-clicks itself and says nothing. That is what produced twenty-two
   * refusals in one first-run session — not a retry loop, a person clicking a
   * control that appeared to be ignoring them.
   *
   * A message from the boundary is rendered verbatim. `secureBridge` already
   * scrubs internal detail before it leaves main, and inventing a friendlier
   * sentence here would mean classifying the failure by regex on English prose,
   * which is what D-6 exists to stop.
   */
  const [error, setError] = useState<string | null>(null);
  const [pref, setPref] = useState<TenantAiPreferenceView | null>(null);

  const describe = (err: unknown): string =>
    err instanceof Error && err.message ? err.message : 'The request failed.';

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setRouting(await ipc.aiConfig.routingStatus());
      setUsage(await ipc.aiConfig.routingUsage());
    } catch (err) {
      log.warn('Routing status unavailable', err);
      setError(describe(err));
    }
    // The organization preference is a separate authority (org:read) and its
    // absence must not blank the platform surface above — degrade to hidden.
    try {
      setPref(await ipc.aiConfig.preference());
    } catch (err) {
      log.warn('Tenant AI preference unavailable', err);
      setPref(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setMode = async (mode: AiMode): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next: AiConfigDto = await ipc.aiConfig.setMode(mode);
      void next;
      await refresh();
    } catch (err) {
      log.warn('Could not set AI mode', err);
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  const setConsent = async (consent: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await ipc.aiConfig.setExternalConsent(consent);
      await refresh();
    } catch (err) {
      log.warn('Could not set consent', err);
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  };

  const setPreference = async (mode: TenantAiMode): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setPref(await ipc.aiConfig.setPreference(mode));
      // The preference now clamps live routing (round 34), so the routes and
      // plan below must re-render from the same change.
      await refresh();
    } catch (err) {
      log.warn('Could not set organization AI preference', err);
      setError(describe(err));
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

        {error !== null && (
          <p
            role="alert"
            className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-2xs leading-relaxed text-danger"
          >
            {error}
          </p>
        )}
      </section>

      {/* ── Organization preference (round 34: finally shown after first-run) ── */}
      {pref !== null && (
        <section aria-label="Organization AI preference">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">
            Organization preference
          </h3>
          <p className="mb-1.5 text-2xs leading-relaxed text-faint">
            Your organization&apos;s choice from setup. It can only narrow the platform mode above — the
            effective mode is the stricter of the two, and it is what requests actually use.
          </p>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Organization AI preference">
            {TENANT_AI_MODES.map((mode: TenantAiMode) => (
              <label
                key={mode}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-2xs transition ${
                  pref.tenantMode === mode ? 'border-accent/60 bg-accent/10' : 'border-[var(--hairline)] hover:bg-white/5'
                }`}
              >
                <input
                  type="radio"
                  name="tenant-ai-preference"
                  checked={pref.tenantMode === mode}
                  disabled={busy}
                  onChange={() => void setPreference(mode)}
                />
                {AI_MODE_LABELS[mode]}
              </label>
            ))}
            <span className="text-2xs text-muted">
              Effective mode: <strong>{AI_MODE_LABELS[pref.effectiveMode]}</strong>
            </span>
          </div>
          {pref.restrictedByPlatform && (
            <p role="status" className="mt-1.5 text-2xs text-amber-400">
              The platform mode above currently restricts this preference — the stricter setting wins.
            </p>
          )}
        </section>
      )}

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
