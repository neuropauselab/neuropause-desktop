import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FeatureFlagState,
  LicenseSource,
  LicenseState,
  LicenseValidationStatus,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Skeleton } from '@renderer/components/ui/Skeleton';
import { useCloudOrg } from '@renderer/organization/CloudOrgProvider';

/**
 * Subscription Center (V6.2) — the user-facing view of the commercial platform.
 *
 * REUSES existing infrastructure and duplicates none of it: the license validator
 * (`ipc.license.status`), the feature gate (`ipc.flags.get`), and the org context
 * (`useCloudOrg`). As a side effect it reports license health to main
 * (`ipc.license.reportHealth`), which activates the V6.1 NeuroCore license signal.
 *
 * Security: renders only commercial STATE (plan, dates, license state, flags).
 * `LicenseValidationStatus` carries no keys, tokens, or gateway secrets, and none
 * are requested here.
 */

const STATE_LABEL: Record<LicenseState, string> = {
  valid: 'Active',
  grace: 'Grace period',
  invalid: 'Expired',
};

const STATE_TONE: Record<LicenseState, string> = {
  valid: 'text-ink',
  grace: 'text-white',
  invalid: 'text-white',
};

const STATE_DOT: Record<LicenseState, string> = {
  valid: 'bg-white/70',
  grace: 'bg-white/85',
  invalid: 'bg-white',
};

const SOURCE_LABEL: Record<LicenseSource, string> = {
  remote: 'Live — verified with server',
  cache: 'Offline — using cached license',
  none: 'Not yet validated',
};

/** Human labels for the known feature-flag keys (falls back to the key). */
const FEATURE_LABEL: Record<string, string> = {
  cloud_sync: 'Cloud Sync',
  automation_builder: 'Automation Builder',
  ai_memory_search: 'AI Memory Search',
  advanced_analytics: 'Advanced Analytics',
  multi_workspace: 'Multiple Workspaces',
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.ceil((then - Date.now()) / 86_400_000));
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function SubscriptionCenter(): JSX.Element {
  const { activeOrg, activeOrgId } = useCloudOrg();
  const [status, setStatus] = useState<LicenseValidationStatus | null>(null);
  const [features, setFeatures] = useState<FeatureFlagState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const s = await ipc.license.status(activeOrgId);
      setStatus(s);
      // Activate the V6.1 NeuroCore license signal (the renderer holds the org).
      if (s?.evaluation) {
        void ipc.license
          .reportHealth(s.evaluation.state, s.evaluation.graceDaysRemaining)
          .catch(() => {});
      }
      const plan = s?.evaluation?.entitledPlan ?? 'free';
      const flags = await ipc.flags.get(plan);
      setFeatures(flags ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load subscription');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ev = status?.evaluation ?? null;
  const snap = status?.snapshot ?? null;
  const state: LicenseState = ev?.state ?? 'invalid';
  const renewalDays = daysUntil(snap?.currentPeriodEnd ?? null);
  const trialDays = daysUntil(snap?.trialEndsAt ?? null);

  const planLabel = useMemo(() => {
    const p = ev?.entitledPlan ?? snap?.planTier ?? 'free';
    return p.charAt(0).toUpperCase() + p.slice(1);
  }, [ev?.entitledPlan, snap?.planTier]);

  if (!activeOrgId) {
    return (
      <EmptyState
        icon="shield"
        title="No organization selected"
        description="Select or create an organization to see its subscription and license."
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <div className="mb-2 flex items-center gap-2 text-sm text-ink">
          <Icon name="info" size={15} /> Couldn't load subscription
        </div>
        <p className="mb-3 text-xs text-white/60">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-ink hover:bg-white/15"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* License card */}
      <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink">
                {planLabel}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-faint">
                <span className={cn('h-1.5 w-1.5 rounded-full', STATE_DOT[state])} />
                <span className={STATE_TONE[state]}>{STATE_LABEL[state]}</span>
              </span>
            </div>
            <div className="text-sm text-white/60">{activeOrg?.name ?? 'Organization'}</div>
          </div>
          {state === 'valid' && renewalDays !== null ? (
            <div className="text-right">
              <div className="text-2xl font-semibold text-ink">{renewalDays}</div>
              <div className="text-[10px] uppercase tracking-wide text-white/40">
                days to renewal
              </div>
            </div>
          ) : state === 'grace' && ev ? (
            <div className="text-right">
              <div className="text-2xl font-semibold text-white">{ev.graceDaysRemaining}</div>
              <div className="text-[10px] uppercase tracking-wide text-white/40">
                grace days left
              </div>
            </div>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs sm:grid-cols-3">
          <Field label="License state" value={STATE_LABEL[state]} />
          <Field label="Subscription" value={snap?.status ? snap.status.replace('_', ' ') : '—'} />
          <Field
            label="Trial"
            value={trialDays !== null ? `${trialDays} days left` : 'Not on trial'}
          />
          <Field label="Renewal date" value={fmtDate(snap?.currentPeriodEnd ?? null)} />
          <Field label="Expires" value={fmtDate(ev?.expiresAt ?? null)} />
          <Field label="Organization" value={activeOrg?.name ?? activeOrgId} />
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/5 pt-3 text-[11px] text-white/45">
          <span className="inline-flex items-center gap-1.5">
            <Icon name={status?.source === 'cache' ? 'clock' : 'shield'} size={12} />
            {SOURCE_LABEL[status?.source ?? 'none']}
          </span>
          {status?.checkedAt && <span>· Last validated {fmtDate(status.checkedAt)}</span>}
          {status?.lastError && <span className="text-white/70">· {status.lastError}</span>}
        </div>
      </div>

      {/* Feature availability — derived from the FeatureGate, never hardcoded */}
      <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-5">
        <div className="mb-3 text-sm font-medium text-ink">Plan features</div>
        {features.length === 0 ? (
          <p className="text-xs text-white/50">No feature information available.</p>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {features.map((f) => {
              const icon: IconName = f.enabled ? 'check' : 'lock';
              return (
                <div
                  key={f.key}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs',
                    f.enabled ? '[background:var(--fill-2)] text-ink' : 'text-white/35',
                  )}
                  title={f.description}
                >
                  <Icon name={icon} size={13} className={f.enabled ? '' : 'opacity-60'} />
                  <span>{FEATURE_LABEL[f.key] ?? f.key}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-white/35">{label}</dt>
      <dd className="mt-0.5 truncate capitalize text-white/75">{value}</dd>
    </div>
  );
}
