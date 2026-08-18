import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BillingPlanId,
  CloudOrganizationSummary,
  FeatureFlagState,
  LicenseSource,
  LicenseState,
  LicenseValidationStatus,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { fetchActiveCloudOrg, AMBIGUOUS_ORG_MESSAGE } from '@renderer/lib/activeOrg';
import { cn } from '@renderer/lib/cn';
import { useIsLocalMode } from '@renderer/shell/useIsLocalMode';
import { CloudUnavailableLocal } from '@renderer/shell/CloudUnavailableLocal';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Skeleton } from '@renderer/components/ui/Skeleton';

/**
 * Subscription Center (V6.2) — the user-facing view of the commercial platform.
 *
 * REUSES existing infrastructure and duplicates none of it: the license validator
 * (ipc.license.status), the feature gate (ipc.flags.get), and the org list
 * (ipc.org.list). It sources the active org directly via IPC rather than
 * useCloudOrg, so it works anywhere — Settings is NOT inside CloudOrgProvider,
 * and that hook throws outside it.
 *
 * As a side effect it reports license health to main (ipc.license.reportHealth),
 * which activates the V6.1 NeuroCore license signal.
 *
 * Security: renders only commercial STATE (plan, dates, license state, flags).
 * LicenseValidationStatus carries no keys, tokens, or gateway secrets.
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
  // S17 — billing/subscription is a cloud feature: honestly absent in local mode
  // (no connected account), never a "Sign in to manage billing" error card.
  if (useIsLocalMode()) return <CloudUnavailableLocal feature="Billing" />;
  return <SubscriptionCenterContent />;
}

function SubscriptionCenterContent(): JSX.Element {
  const [org, setOrg] = useState<CloudOrganizationSummary | null>(null);
  const [orgLoaded, setOrgLoaded] = useState(false);
  const [status, setStatus] = useState<LicenseValidationStatus | null>(null);
  const [features, setFeatures] = useState<FeatureFlagState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Inline org creation (V6.3) — the lightweight first-run wizard, reusing
  // ipc.org.create. Creating an org here activates the whole commercial chain.
  const [creating, setCreating] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Upgrade / checkout (V6.4)
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Round 36 — Gate 15: a failed org list must NEVER render the
      // create-your-first-org wizard to someone who already has one — that
      // failure now throws into the error state; ambiguity is said, not
      // guessed (FINDING-6 rule via the shared resolver).
      const { orgs, active } = await fetchActiveCloudOrg();
      if (active === null && orgs.length > 0) throw new Error(AMBIGUOUS_ORG_MESSAGE);
      setOrg(active);
      setOrgLoaded(true);
      if (!active) return;

      // Fetch from the backend (refresh), not the local cache (status): a brand-new
      // org has an empty cache, but the backend treats "no subscription" as a VALID
      // free license. refresh falls back to cache on network failure.
      const s = await ipc.license.refresh(active.orgId);
      setStatus(s);
      // Activate the V6.1 NeuroCore license signal.
      if (s?.evaluation) {
        void ipc.license
          .reportHealth(s.evaluation.state, s.evaluation.graceDaysRemaining)
          .catch(() => {});
      }
      const plan = s?.evaluation?.entitledPlan ?? 'free';
      const flags = await ipc.flags.get(plan).catch(() => [] as FeatureFlagState[]);
      setFeatures(flags ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load subscription');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // When the user returns from the Razorpay checkout (window regains focus),
  // re-check the license — the webhook may have activated the subscription.
  useEffect(() => {
    const onFocus = (): void => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const upgrade = async (plan: BillingPlanId, seats?: number): Promise<void> => {
    if (!org || checkingOut) return;
    setCheckingOut(true);
    setCheckoutError(null);
    try {
      // Opens the Razorpay hosted checkout in the browser (main-side). Card data
      // never touches the desktop; the backend + webhook finalize the subscription.
      await ipc.billing.checkout(org.orgId, plan, seats);
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : 'Could not start checkout');
    } finally {
      setCheckingOut(false);
    }
  };

  const createOrg = async (): Promise<void> => {
    const name = orgName.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      await ipc.org.create({ name });
      setCreating(false);
      setOrgName('');
      // Re-run the whole load: the new org resolves, license is fetched, and the
      // V6.1 NeuroCore signal fires — the commercial chain comes online.
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create organization');
    } finally {
      setSubmitting(false);
    }
  };

  const ev = status?.evaluation ?? null;
  const snap = status?.snapshot ?? null;
  const state: LicenseState = ev?.state ?? 'invalid';
  const renewalDays = daysUntil(snap?.currentPeriodEnd ?? null);
  const trialDays = daysUntil(snap?.trialEndsAt ?? null);

  const planLabel = useMemo(() => {
    const p = ev?.entitledPlan ?? snap?.planTier ?? 'free';
    return p.charAt(0).toUpperCase() + p.slice(1);
  }, [ev?.entitledPlan, snap?.planTier]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  if (orgLoaded && !org) {
    return (
      <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-6 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
          <Icon name="shield" size={20} />
        </div>
        <div className="mb-1 text-sm font-medium text-ink">No organization yet</div>
        <p className="mx-auto mb-4 max-w-sm text-xs text-white/55">
          Your subscription and license are organization-scoped. Create one to activate your
          commercial plan and license.
        </p>
        {creating ? (
          <div className="mx-auto max-w-xs space-y-2 text-left">
            <input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createOrg();
              }}
              placeholder="Organization name"
              aria-label="Organization name"
              autoFocus
              disabled={submitting}
              className="w-full rounded-xl border border-[var(--hairline)] [background:var(--fill-2)] px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus-visible:shadow-focus disabled:opacity-60"
            />
            {createError && <p className="text-xs text-white/70">{createError}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void createOrg()}
                disabled={submitting || orgName.trim().length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-40"
              >
                {submitting ? (
                  <>
                    <Icon name="refresh" size={13} className="animate-spin" /> Creating…
                  </>
                ) : (
                  'Create organization'
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setCreateError(null);
                }}
                disabled={submitting}
                className="rounded-lg px-3 py-2 text-xs text-white/50 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black hover:opacity-90"
          >
            <Icon name="plus" size={13} /> Create organization
          </button>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <div className="mb-2 flex items-center gap-2 text-sm text-ink">
          <Icon name="info" size={15} /> Couldn&apos;t load subscription
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
            <div className="text-sm text-white/60">{org?.name ?? 'Organization'}</div>
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
          <Field label="Organization" value={org?.name ?? '—'} />
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/5 pt-3 text-[11px] text-white/45">
          <span className="inline-flex items-center gap-1.5">
            <Icon name={status?.source === 'cache' ? 'clock' : 'shield'} size={12} />
            {SOURCE_LABEL[status?.source ?? 'none']}
          </span>
          {status?.checkedAt && <span>· Last validated {fmtDate(status.checkedAt)}</span>}
        </div>

        {(ev?.entitledPlan ?? snap?.planTier ?? 'free') === 'free' && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--hairline)] [background:var(--fill-2)] p-3">
            <div className="text-xs text-white/70">
              <span className="font-medium text-ink">Upgrade to Pro</span> — unlimited AI, Cloud
              Sync, analytics, and more.
            </div>
            <button
              type="button"
              onClick={() => void upgrade('professional', 1)}
              disabled={checkingOut}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-50"
            >
              {checkingOut ? (
                <>
                  <Icon name="refresh" size={13} className="animate-spin" /> Opening checkout…
                </>
              ) : (
                <>Upgrade — ₹999/mo</>
              )}
            </button>
          </div>
        )}
        {checkoutError && <p className="mt-2 text-xs text-white/70">{checkoutError}</p>}
      </div>

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
