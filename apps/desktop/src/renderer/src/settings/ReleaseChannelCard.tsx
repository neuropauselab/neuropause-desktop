/**
 * Release Channel card — the Settings surface for the app's OWN auto-update, over the existing `update:*`
 * backend via the new `ipc.updater` wrapper. It renders from the real, authoritative `UpdateStatus`
 * (current version, channel, phase, availability, progress), subscribes to the live main-side status
 * broadcast so it stays current without polling, and drives real actions: check now, download, restart to
 * install, and channel switching (stable / beta / internal — the honest channel set; there is no
 * "nightly"). All labels/affordances come from the pure shared `releaseChannelMeta` helpers, and every
 * action is confirmed through the Increment-2 toast system. Unpackaged/unconfigured builds report
 * `supported: false` and get an informational state instead of controls.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  selectableReleaseChannels,
  releaseChannelLabel,
  releaseChannelDescription,
  updatePhaseLabel,
  updateStatusHeadline,
  formatUpdateProgressPercent,
  canCheckForUpdate,
  canDownloadUpdate,
  canInstallUpdate,
  canSwitchChannel,
  type UpdateChannel,
  type UpdatePhase,
  type UpdateStatus,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { useToast } from '@renderer/state/ToastProvider';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { Badge, SegmentedControl } from '@renderer/components/ui/controls';
import { Skeleton } from '@renderer/components/ui/Skeleton';

type Tone = 'neutral' | 'accent' | 'blue' | 'green' | 'orange' | 'pink';

const PHASE_TONE: Record<UpdatePhase, Tone> = {
  idle: 'neutral',
  checking: 'blue',
  available: 'accent',
  'not-available': 'neutral',
  downloading: 'blue',
  downloaded: 'green',
  error: 'pink',
};

function fmtWhen(iso: string | null): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ReleaseChannelCard(): JSX.Element {
  const { success, info, error: toastError } = useToast();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'check' | 'download' | 'install' | 'channel' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await ipc.updater.getStatus());
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Stay live: the main process broadcasts every status transition.
  useEffect(() => {
    const off = ipc.updater.onEvent((s) => setStatus(s));
    return off;
  }, []);

  const check = async (): Promise<void> => {
    setBusy('check');
    try {
      setStatus(await ipc.updater.checkNow());
    } catch {
      toastError('Could not check for updates');
    } finally {
      setBusy(null);
    }
  };

  const download = async (): Promise<void> => {
    setBusy('download');
    try {
      setStatus(await ipc.updater.download());
      success('Downloading update');
    } catch {
      toastError('Could not start the download');
    } finally {
      setBusy(null);
    }
  };

  const install = async (): Promise<void> => {
    setBusy('install');
    info('Restarting to install the update…', { durationMs: 0 });
    try {
      // Restart-to-apply: main quits and installs. If it returns, surface the (rare) failure.
      await ipc.updater.installOnQuit();
    } catch {
      toastError('Could not install the update');
    } finally {
      setBusy(null);
    }
  };

  const switchChannel = async (channel: UpdateChannel): Promise<void> => {
    if (!status || channel === status.channel || !canSwitchChannel(status)) return;
    setBusy('channel');
    try {
      const fresh = await ipc.updater.setChannel(channel);
      setStatus(fresh);
      success(`Now on the ${releaseChannelLabel(channel)} channel`, {
        message: 'NeuroPause will use this channel the next time it checks for updates.',
      });
    } catch {
      toastError('Could not switch channel');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <Skeleton className="h-52 w-full rounded-2xl" />;
  }

  if (!status) {
    return (
      <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
        <div className="mb-2 flex items-center gap-2 text-sm text-ink">
          <Icon name="info" size={15} /> Update status unavailable
        </div>
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

  // Phase 8 (8.5): only channels with a PUBLISHED feed are offered —
  // `internal` had none, stranding anyone who picked it in silent failure.
  const channels = selectableReleaseChannels();
  const pct = status.progress ? formatUpdateProgressPercent(status.progress.percent) : '0%';

  return (
    <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">Version {status.currentVersion}</span>
            <Badge tone={PHASE_TONE[status.phase]}>{updatePhaseLabel(status.phase)}</Badge>
          </div>
          <p className="text-xs text-white/60">{updateStatusHeadline(status)}</p>
        </div>
        {status.supported && (
          <Button
            variant="secondary"
            size="sm"
            icon="refresh"
            loading={busy === 'check'}
            disabled={!canCheckForUpdate(status)}
            onClick={() => void check()}
          >
            Check now
          </Button>
        )}
      </div>

      {status.phase === 'downloading' && status.progress && (
        <div className="mb-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full [background:var(--fill-2)]">
            <div className="h-full rounded-full bg-accent transition-[width,height] motion-reduce:transition-none" style={{ width: pct }} />
          </div>
          <div className="mt-1 text-2xs text-white/45">{pct} downloaded</div>
        </div>
      )}

      {(canDownloadUpdate(status) || canInstallUpdate(status)) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {canDownloadUpdate(status) && (
            <Button
              variant="primary"
              size="sm"
              icon="download"
              loading={busy === 'download'}
              onClick={() => void download()}
            >
              Download update
            </Button>
          )}
          {canInstallUpdate(status) && (
            <Button
              variant="primary"
              size="sm"
              icon="bolt"
              loading={busy === 'install'}
              onClick={() => void install()}
            >
              Restart to install
            </Button>
          )}
        </div>
      )}

      <div className="mb-1.5 px-0.5 text-2xs font-semibold uppercase tracking-wider text-faint">
        Channel
      </div>
      {status.supported ? (
        <SegmentedControl<UpdateChannel>
          options={channels.map((c) => ({ value: c, label: releaseChannelLabel(c) }))}
          value={status.channel}
          onChange={(c) => void switchChannel(c)}
          size="sm"
        />
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] [background:var(--fill-2)] px-2.5 py-1 text-xs text-ink">
          {releaseChannelLabel(status.channel)}
        </span>
      )}
      <p className="mt-2 px-0.5 text-xs text-white/50">
        {releaseChannelDescription(status.channel)}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/5 pt-3 text-[11px] text-white/45">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="clock" size={12} /> Last checked {fmtWhen(status.checkedAt)}
        </span>
        {!status.supported && (
          <span className="inline-flex items-center gap-1.5">
            <Icon name="info" size={12} /> Automatic updates run in the packaged app
          </span>
        )}
      </div>
    </div>
  );
}
