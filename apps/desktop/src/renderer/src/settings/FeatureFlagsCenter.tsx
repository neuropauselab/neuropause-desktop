/**
 * Feature Flags Center — the Settings surface that MANAGES feature flags (the existing read-only "Plan
 * features" grid in SubscriptionCenter only displays them). It reuses the real backend end-to-end:
 * `ipc.flags.get/setOverride/clearOverride`, evaluated against the same plan tier SubscriptionCenter
 * derives (org → license → entitledPlan, since Settings is NOT under CloudOrgProvider). All organizing /
 * searching / grouping is the pure shared `flagCatalog` layer; nothing here invents flags or state. Every
 * toggle writes a real per-install override and is confirmed through the Increment-2 toast system; "Reset"
 * clears overrides back to the real default/plan value. The list refreshes from the authoritative
 * `FeatureFlagState[]` the IPC returns after each mutation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildFlagCatalog,
  filterFlagCatalog,
  groupFlagCatalog,
  overriddenFlagKeys,
  flagCatalogSummary,
  flagLabel,
  flagSourceLabel,
  planTierLabel,
  type FeatureFlagKey,
  type FeatureFlagState,
  type FeatureFlagSource,
  type PlanTier,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { fetchActiveCloudOrg, AMBIGUOUS_ORG_MESSAGE } from '@renderer/lib/activeOrg';
import { useToast } from '@renderer/state/ToastProvider';
import { Icon } from '@renderer/components/ui/Icon';
import { Toggle, Badge } from '@renderer/components/ui/controls';
import { Skeleton } from '@renderer/components/ui/Skeleton';

const SOURCE_TONE: Record<FeatureFlagSource, 'neutral' | 'accent' | 'blue'> = {
  default: 'neutral',
  override: 'accent',
  plan: 'blue',
};

export function FeatureFlagsCenter(): JSX.Element {
  const { success, error: toastError } = useToast();
  const [plan, setPlan] = useState<PlanTier>('free');
  const [states, setStates] = useState<FeatureFlagState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busyKey, setBusyKey] = useState<FeatureFlagKey | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Round 36 — Gate 15: a failed org/license read must NEVER quietly
      // become free-tier entitlements for a paying customer. Failures throw
      // into the error state below; only a GENUINE no-org account is free.
      const { orgs, active } = await fetchActiveCloudOrg();
      if (active === null && orgs.length > 0) throw new Error(AMBIGUOUS_ORG_MESSAGE);
      let tier: PlanTier = 'free';
      if (active) {
        const s = await ipc.license.refresh(active.orgId);
        tier = s?.evaluation?.entitledPlan ?? 'free';
      }
      setPlan(tier);
      const flags = await ipc.flags.get(tier);
      setStates(flags ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load feature flags');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (key: FeatureFlagKey, next: boolean): Promise<void> => {
    setBusyKey(key);
    const prev = states;
    // Optimistic: reflect the override immediately; the IPC returns the authoritative array.
    setStates((cur) =>
      cur.map((s) => (s.key === key ? { ...s, enabled: next, source: 'override' } : s)),
    );
    try {
      const fresh = await ipc.flags.setOverride(key, next, plan);
      setStates(fresh);
      success(`${flagLabel(key)} ${next ? 'enabled' : 'disabled'}`);
    } catch {
      setStates(prev);
      toastError(`Couldn't update ${flagLabel(key)}`);
    } finally {
      setBusyKey(null);
    }
  };

  const resetOne = async (key: FeatureFlagKey): Promise<void> => {
    setBusyKey(key);
    try {
      const fresh = await ipc.flags.clearOverride(key, plan);
      setStates(fresh);
      success(`${flagLabel(key)} reset to default`);
    } catch {
      toastError(`Couldn't reset ${flagLabel(key)}`);
    } finally {
      setBusyKey(null);
    }
  };

  const resetAll = async (): Promise<void> => {
    const keys = overriddenFlagKeys(states);
    if (keys.length === 0 || resetting) return;
    setResetting(true);
    try {
      let latest = states;
      for (const k of keys) {
        // No bulk-clear channel exists; clear each override through the real per-key channel.
        latest = await ipc.flags.clearOverride(k, plan);
      }
      setStates(latest);
      success(`Reset ${keys.length} override${keys.length > 1 ? 's' : ''} to defaults`);
    } catch {
      toastError('Could not reset all overrides');
    } finally {
      setResetting(false);
    }
  };

  const summary = useMemo(() => flagCatalogSummary(states), [states]);
  const groups = useMemo(
    () => groupFlagCatalog(filterFlagCatalog(buildFlagCatalog(states), query)),
    [states, query],
  );

  if (loading) {
    return (
      <div className="space-y-2.5">
        <Skeleton className="h-11 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <div className="mb-2 flex items-center gap-2 text-sm text-ink">
          <Icon name="info" size={15} /> Couldn&apos;t load feature flags
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
    <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-white/55">
          <span className="font-medium text-ink">{summary.enabled}</span> of {summary.total} enabled
          {summary.overridden > 0 && (
            <>
              {' · '}
              <span className="text-ink">{summary.overridden}</span> overridden
            </>
          )}
          {' · '}
          <span className="capitalize">{planTierLabel(plan)} plan</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void resetAll()}
            disabled={summary.overridden === 0 || resetting}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-white/60 hover:text-ink disabled:opacity-40"
          >
            <Icon name="undo" size={13} className={resetting ? 'animate-spin' : ''} /> Reset all
          </button>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh flags"
            title="Refresh"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-white/60 hover:text-ink"
          >
            <Icon name="refresh" size={14} />
          </button>
        </div>
      </div>

      <div className="relative mb-4">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
          <Icon name="search" size={14} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search flags…"
          aria-label="Search feature flags"
          className="h-9 w-full rounded-lg border border-[var(--hairline)] [background:var(--fill-2)] pl-9 pr-3 text-sm text-ink outline-none placeholder:text-faint focus-visible:shadow-focus"
        />
      </div>

      {groups.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-white/45">No flags match “{query}”.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.category}>
              <div className="mb-1.5 px-1 text-2xs font-semibold uppercase tracking-wider text-faint">
                {group.category}
              </div>
              <div className="overflow-hidden rounded-xl border border-[var(--hairline)]">
                {group.entries.map((entry, i) => (
                  <div
                    key={entry.key}
                    className={
                      'flex items-center justify-between gap-3 px-3.5 py-3 ' +
                      (i > 0 ? 'border-t border-[var(--hairline)]' : '')
                    }
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{entry.label}</span>
                        <Badge tone={SOURCE_TONE[entry.source]}>{flagSourceLabel(entry.source)}</Badge>
                        {entry.lockedByPlan && entry.minPlan && (
                          <span className="inline-flex items-center gap-1 text-2xs text-white/45">
                            <Icon name="lock" size={11} /> Requires {planTierLabel(entry.minPlan)}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-white/50">{entry.description}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {entry.overridden && (
                        <button
                          type="button"
                          onClick={() => void resetOne(entry.key)}
                          disabled={busyKey === entry.key}
                          aria-label={`Reset ${entry.label}`}
                          title="Reset to default"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-white/45 hover:text-ink disabled:opacity-40"
                        >
                          <Icon name="undo" size={13} />
                        </button>
                      )}
                      <Toggle
                        checked={entry.enabled}
                        onChange={(v) => void toggle(entry.key, v)}
                        disabled={busyKey === entry.key}
                        label={`Toggle ${entry.label}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 px-1 text-2xs text-white/35">
        Overrides are stored on this device and take effect immediately. Plan-gated flags show the tier
        they require.
      </p>
    </div>
  );
}
