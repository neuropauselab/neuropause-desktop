import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { AppInfo, Session, ThemeSource } from '@neuropause/shared';
import { useAuth } from '@renderer/providers/AuthProvider';
import { useTheme } from '@renderer/providers/ThemeProvider';
import { TitleBar } from '@renderer/components/TitleBar';
import { Spinner } from '@renderer/components/Spinner';
import { ipc } from '@renderer/lib/ipc';

const THEME_OPTIONS: { value: ThemeSource; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Compact segmented theme control for the title bar. */
function ThemeControl(): JSX.Element {
  const { source, setSource } = useTheme();
  return (
    <div className="flex rounded-lg border border-surface-border bg-surface-base p-0.5">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setSource(opt.value)}
          className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition ${
            source === opt.value ? 'bg-white/15 text-white' : 'text-muted hover:text-white'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// The modules that will be built out in subsequent phases. Shown here as an
// honest preview of what is coming, not as functional surfaces.
const UPCOMING = [
  { phase: 2, title: 'Workspace', desc: 'Launch and arrange AI apps with tabs and split view.' },
  { phase: 3, title: 'AI Store', desc: 'Discover, install, and launch AI products.' },
  { phase: 4, title: 'AI Connectors', desc: 'Securely link your AI SaaS accounts via OAuth.' },
  { phase: 5, title: 'Activity & Reminders', desc: 'A timeline of your work with smart nudges.' },
  { phase: 5, title: 'Daily Summary', desc: 'An AI recap of what you did and what is next.' },
  { phase: 6, title: 'AI Memory', desc: 'Search everything you have worked on in plain language.' },
];

export function HomeScreen({ session }: { session: Session }): JSX.Element {
  const { logout } = useAuth();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    void ipc.app.getInfo().then((info) => {
      if (active) setAppInfo(info);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleLogout = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  };

  const name = session.user.displayName ?? session.user.email;

  return (
    <div className="app-bg flex h-full w-full flex-col">
      <TitleBar
        right={
          <>
            <ThemeControl />
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={signingOut}
              className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-base px-2.5 py-1 text-[11.5px] font-medium text-muted transition hover:text-white disabled:opacity-50"
            >
              {signingOut ? <Spinner size={12} /> : null}
              Sign out
            </button>
          </>
        }
      />

      <main className="flex-1 overflow-y-auto px-8 pb-10 pt-2">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mx-auto w-full max-w-3xl"
        >
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {name}</h1>
          <p className="mt-1.5 text-[14px] text-muted">
            You are signed in. This is the foundation — the workspace and modules below arrive in
            the next phases.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {UPCOMING.map((m) => (
              <div key={m.title} className="glass-panel rounded-2xl p-5">
                <div className="mb-2 inline-flex rounded-full bg-accent/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-accent">
                  Phase {m.phase}
                </div>
                <h3 className="text-[15px] font-semibold">{m.title}</h3>
                <p className="mt-1 text-[13px] text-muted">{m.desc}</p>
              </div>
            ))}
          </div>

          {appInfo ? (
            <p className="mt-8 text-center text-[11.5px] text-muted">
              {appInfo.name} v{appInfo.version} · Electron {appInfo.electronVersion} ·{' '}
              {appInfo.platform}
              {appInfo.isPackaged ? '' : ' · dev'}
            </p>
          ) : null}
        </motion.div>
      </main>
    </div>
  );
}
