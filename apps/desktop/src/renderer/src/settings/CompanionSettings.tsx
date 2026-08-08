import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type {
  CompanionDeviceDto,
  CompanionPairingQrDto,
  CompanionStatusDto,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Card } from '@renderer/components/ui/Card';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { Toggle } from '@renderer/components/ui/controls';
import { Skeleton } from '@renderer/components/ui/Skeleton';

/**
 * Companion settings (Mobile M1-03) — the desktop control surface for the LAN
 * mobile gateway. Everything here reads real gateway state over the
 * `companion:*` IPC: switch the gateway on, show its LAN address, mint a
 * pairing QR the phone scans, and list / revoke paired devices. No fabricated
 * state — when the gateway is off or the desktop is signed out, the pane says
 * so instead of showing a dead control.
 */

const PLATFORM_LABEL: Record<string, string> = { ios: 'iOS', android: 'Android' };

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const secs = Math.round((Date.now() - t) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

export function CompanionSettings(): JSX.Element {
  const [status, setStatus] = useState<CompanionStatusDto | null>(null);
  const [devices, setDevices] = useState<CompanionDeviceDto[]>([]);
  const [pairing, setPairing] = useState<CompanionPairingQrDto | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, d] = await Promise.all([ipc.companion.status(), ipc.companion.devices()]);
      setStatus(s);
      setDevices(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load companion status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = ipc.companion.onEvent(() => void load());
    return () => unsubscribe();
  }, [load]);

  // Count the active pairing token down; drop it when it expires.
  useEffect(() => {
    if (!pairing) return;
    const tick = (): void => {
      const left = Math.max(0, Math.round((Date.parse(pairing.expiresAt) - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setPairing(null);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [pairing]);

  const setEnabled = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const s = await ipc.companion.enable(enabled);
      setStatus(s);
      if (!enabled) setPairing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the companion gateway');
    } finally {
      setBusy(false);
    }
  };

  const startPairing = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setPairing(await ipc.companion.pairingQr());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a pairing code');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (deviceId: string): Promise<void> => {
    try {
      await ipc.companion.revoke(deviceId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not unpair the device');
    }
  };

  if (loading) return <Skeleton className="h-40 w-full rounded-2xl" />;

  const running = status?.running ?? false;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-4 text-xs text-white/70">
          {error}
        </div>
      )}

      <section>
        <h3 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-faint">
          Mobile companion
        </h3>
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <Icon name="globe" size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink">Companion gateway</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-white/45">
                Lets the NeuroPause phone app reach this desktop over your local network. Traffic is
                end-to-end encrypted and the phone only sees dashboards, approvals and briefings —
                never your raw records.
              </p>
              {running && status?.host && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2 py-1 text-[11px] text-white/55">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Listening on {status.host}:{status.port}
                </div>
              )}
              {status && !status.signedIn && (
                <p className="mt-2 text-[11px] text-amber-300/80">
                  Sign in on this desktop for the phone to load data.
                </p>
              )}
            </div>
            <Toggle
              checked={status?.enabled ?? false}
              disabled={busy}
              onChange={(v) => void setEnabled(v)}
              label="Enable companion gateway"
            />
          </div>
        </Card>
      </section>

      {running && (
        <section>
          <h3 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-faint">
            Pair a device
          </h3>
          <Card className="p-4">
            {pairing ? (
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-2xl bg-white p-3">
                  <QRCodeSVG value={pairing.qr} size={196} level="M" marginSize={0} />
                </div>
                <p className="text-center text-[11px] text-white/55">
                  Open NeuroPause on your phone and scan this code.
                  <br />
                  Expires in {secondsLeft}s.
                </p>
                <Button
                  variant="ghost"
                  icon="refresh"
                  onClick={() => void startPairing()}
                  disabled={busy}
                >
                  New code
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-white/50">
                  Generate a one-time QR code to pair a new phone. The code expires after five
                  minutes.
                </p>
                <Button icon="plus" onClick={() => void startPairing()} disabled={busy}>
                  Pair device
                </Button>
              </div>
            )}
          </Card>
        </section>
      )}

      <section>
        <h3 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-faint">
          Paired devices{devices.length > 0 && ` (${devices.filter((d) => !d.revoked).length})`}
        </h3>
        <div className="overflow-hidden rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)]">
          {devices.length === 0 ? (
            <p className="p-4 text-xs text-white/50">No devices paired yet.</p>
          ) : (
            devices.map((d, i) => (
              <div
                key={d.id}
                className={cn(
                  'flex items-center gap-3 p-3.5',
                  i > 0 && 'border-t border-white/5',
                  d.revoked && 'opacity-50',
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon name="globe" size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-ink">{d.name}</span>
                    {d.revoked && (
                      <span className="shrink-0 text-[10px] text-white/50">Revoked</span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-white/45">
                    {PLATFORM_LABEL[d.platform] ?? d.platform}
                    {d.model ? ` · ${d.model}` : ''} · paired {relativeTime(d.createdAt)} · seen{' '}
                    {relativeTime(d.lastSeenAt)}
                  </div>
                </div>
                {!d.revoked && (
                  <button
                    type="button"
                    onClick={() => void revoke(d.id)}
                    className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] text-white/50 hover:bg-white/10 hover:text-white"
                    title="Unpair this device"
                  >
                    Unpair
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
