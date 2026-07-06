import { useEffect, useState, type ReactNode } from 'react';
import type { AppInfo, Session, ThemeSource } from '@neuropause/shared';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { Card } from '@renderer/components/ui/Card';
import { Button } from '@renderer/components/ui/Button';
import {
  Avatar,
  SegmentedControl,
  Toggle,
  type SegmentOption,
} from '@renderer/components/ui/controls';
import { initials } from '@renderer/lib/format';
import { useTheme } from '@renderer/providers/ThemeProvider';
import { useAuth } from '@renderer/providers/AuthProvider';
import { ipc } from '@renderer/lib/ipc';
import { useScale } from '@renderer/state/ScaleProvider';
import { SubscriptionCenter } from '@renderer/subscription/SubscriptionCenter';
import { TrustedDevices } from '@renderer/devices/TrustedDevices';
import { EnterpriseOverview } from '@renderer/enterprise/EnterpriseOverview';

const THEME_OPTIONS: SegmentOption<ThemeSource>[] = [
  { value: 'system', label: 'Auto', icon: 'auto' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

function SettingRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <div className="text-base font-medium">{label}</div>
        {description && <div className="mt-0.5 text-sm text-faint">{description}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="mb-2 px-1 text-2xs font-semibold uppercase tracking-wider text-faint">
      {children}
    </div>
  );
}

export function SettingsView({ session }: { session: Session }): JSX.Element {
  const { source, setSource } = useTheme();
  const { scale, setScale, reset, min, max } = useScale();
  const { logout } = useAuth();
  const [info, setInfo] = useState<AppInfo | null>(null);
  // V4.2 launch-at-login toggle, backed by the RuntimeService IPC.
  const [loginAtStartup, setLoginAtStartup] = useState(false);
  const [startupBusy, setStartupBusy] = useState(false);
  const { user } = session;
  const name = user.displayName ?? user.email.split('@')[0];

  useEffect(() => {
    let active = true;
    void ipc.app.getInfo().then((i) => {
      if (active) setInfo(i);
    });
    void ipc.runtime.getLoginAtStartup().then((r) => {
      if (active) setLoginAtStartup(r.enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  const toggleLoginAtStartup = async (next: boolean): Promise<void> => {
    setStartupBusy(true);
    setLoginAtStartup(next); // optimistic
    try {
      const r = await ipc.runtime.setLoginAtStartup(next);
      setLoginAtStartup(r.enabled);
    } catch {
      setLoginAtStartup(!next); // revert on failure
    } finally {
      setStartupBusy(false);
    }
  };

  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <ViewScroll max={720}>
      <ViewHeader title="Settings" subtitle="Manage appearance and your account." />

      <section className="mb-7">
        <SectionLabel>Appearance</SectionLabel>
        <Card className="py-1.5">
          <SettingRow
            label="Theme"
            description="Auto follows your macOS appearance."
            control={
              <SegmentedControl
                options={THEME_OPTIONS}
                value={source}
                onChange={(v) => void setSource(v)}
              />
            }
          />
        </Card>
      </section>

      <section className="mb-7">
        <SectionLabel>Startup</SectionLabel>
        <Card className="py-1.5">
          <SettingRow
            label="Launch at login"
            description="Start NeuroPause automatically when you sign in to your Mac. It opens quietly to the menu bar."
            control={
              <Toggle
                checked={loginAtStartup}
                onChange={(v) => void toggleLoginAtStartup(v)}
                disabled={startupBusy}
                label="Launch NeuroPause at login"
              />
            }
          />
        </Card>
      </section>

      <section className="mb-7">
        <SectionLabel>Display</SectionLabel>
        <Card className="py-1.5">
          <SettingRow
            label="Interface scale"
            description="Scales the whole interface. Also in View ▸ Zoom (⌘+ / ⌘− / ⌘0)."
            control={
              <div className="flex items-center gap-3">
                {scale !== 100 && (
                  <Button size="sm" variant="ghost" onClick={reset}>
                    Reset
                  </Button>
                )}
                <div className="flex w-[220px] items-center gap-3">
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={5}
                    value={scale}
                    onChange={(e) => setScale(Number(e.target.value))}
                    aria-label="Interface scale"
                    className="h-1.5 flex-1 cursor-pointer"
                    style={{ accentColor: 'rgb(var(--accent))' }}
                  />
                  <span className="tabular w-10 text-right text-sm font-medium">{scale}%</span>
                </div>
              </div>
            }
          />
        </Card>
      </section>

      <section className="mb-7">
        <SectionLabel>Account</SectionLabel>
        <Card>
          <div className="flex items-center gap-3.5">
            <Avatar text={initials(name)} size={48} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold">{name}</div>
              <div className="truncate text-sm text-muted">{user.email}</div>
              <div className="mt-0.5 text-xs text-faint">Member since {memberSince}</div>
            </div>
            <Button variant="danger" icon="logout" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </Card>
      </section>

      <section className="mb-7">
        <SectionLabel>Subscription</SectionLabel>
        <SubscriptionCenter />
      </section>

      <section className="mb-7">
        <SectionLabel>Trusted Devices</SectionLabel>
        <TrustedDevices />
      </section>

      <section className="mb-7">
        <SectionLabel>Enterprise Overview</SectionLabel>
        <EnterpriseOverview />
      </section>

      <section>
        <SectionLabel>About</SectionLabel>
        <Card className="py-1.5">
          <SettingRow
            label="NeuroPause"
            description={info ? `Version ${info.version}` : 'Loading…'}
            control={
              <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent">
                {info?.isPackaged ? 'Release' : 'Development'}
              </span>
            }
          />
          <div className="h-px [background:var(--hairline)]" />
          <SettingRow
            label="Runtime"
            control={
              <span className="tabular text-sm text-muted">
                {info ? `Electron ${info.electronVersion} · ${info.platform}` : '—'}
              </span>
            }
          />
        </Card>
        <p className="mt-3 px-1 text-xs text-faint">
          More controls — connectors, automations, and privacy — arrive alongside their modules in
          later phases.
        </p>
      </section>
    </ViewScroll>
  );
}
