import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import type { AuthProviderId } from '@neuropause/shared';
import { useAuth } from '@renderer/providers/AuthProvider';
import { Spinner } from '@renderer/components/Spinner';
import { BackendReachabilityNotice } from './BackendReachabilityNotice';
import { ipc } from '@renderer/lib/ipc';
import {
  AppleIcon,
  GitHubIcon,
  GoogleIcon,
  MicrosoftIcon,
} from '@renderer/components/ProviderIcons';

type OAuthProviderId = Exclude<AuthProviderId, 'email'>;

/**
 * P13C F-8 — the catalogue of buttons this screen KNOWS HOW TO RENDER. It is not
 * the list it offers.
 *
 * Until now this array WAS the offer: four OAuth buttons rendered unconditionally
 * while `/auth/providers` returned `[]`, so every one of them failed. What ships
 * is now the intersection of this catalogue and what the server says it has
 * configured, which is empty until somebody configures a provider.
 */
const PROVIDER_CATALOGUE: { id: OAuthProviderId; label: string; Icon: typeof GoogleIcon }[] = [
  { id: 'google', label: 'Continue with Google', Icon: GoogleIcon },
  { id: 'github', label: 'Continue with GitHub', Icon: GitHubIcon },
  { id: 'microsoft', label: 'Continue with Microsoft', Icon: MicrosoftIcon },
  { id: 'apple', label: 'Continue with Apple', Icon: AppleIcon },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginScreen(): JSX.Element {
  const { status, loginOAuth, loginEmail, registerEmail } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<OAuthProviderId | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // F-8: empty until the server says otherwise. Never optimistic.
  const [enabledProviders, setEnabledProviders] = useState<OAuthProviderId[]>([]);

  useEffect(() => {
    let alive = true;
    void ipc.auth
      .providers()
      .then((r) => {
        if (alive) setEnabledProviders(r.providers.filter((p): p is OAuthProviderId => p !== 'email'));
      })
      .catch(() => {
        // Unknown is not "all four". Leave the list empty.
      });
    return () => {
      alive = false;
    };
  }, []);

  const providers = useMemo(
    () => PROVIDER_CATALOGUE.filter((p) => enabledProviders.includes(p.id)),
    [enabledProviders],
  );

  const authenticating = status.state === 'authenticating';
  const busy = authenticating || submitting || pendingProvider !== null;

  const banner = useMemo(() => {
    if (formError) return formError;
    if (status.state === 'error') return status.message;
    return null;
  }, [formError, status]);

  const handleOAuth = async (provider: OAuthProviderId): Promise<void> => {
    setFormError(null);
    setPendingProvider(provider);
    try {
      await loginOAuth(provider);
    } finally {
      setPendingProvider(null);
    }
  };

  const handleEmailSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    if (!EMAIL_RE.test(email)) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signup') await registerEmail(email, password);
      else await loginEmail(email, password);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-bg flex h-full w-full flex-col">
      <div className="app-drag h-11 w-full shrink-0" />

      <main className="flex flex-1 items-center justify-center px-6 pb-10">
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
          className="glass-panel w-full max-w-[400px] rounded-2xl p-8 shadow-glass"
        >
          {/* Brand + heading */}
          <div className="mb-7 flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 ring-1 ring-accent/30">
              <span className="h-3.5 w-3.5 rounded-full bg-accent" />
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight">Welcome to NeuroPause</h1>
            <p className="mt-1 text-[13px] text-muted">Sign in to your AI operating layer</p>
          </div>

          {/*
            F-7. Above the auth banner deliberately: when the service is
            unreachable, "Invalid email or password" is a true statement about
            the response and a false explanation of the situation. The reader
            should meet the cause before the symptom.
          */}
          <BackendReachabilityNotice />

          {banner ? (
            <div
              className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[12.5px] text-red-300"
              role="alert"
            >
              {banner}
            </div>
          ) : null}

          {/* OAuth providers — only those the server actually has (F-8) */}
          {providers.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {providers.map(({ id, label, Icon }) => {
              const isPending = pendingProvider === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => void handleOAuth(id)}
                  className="app-no-drag flex h-11 items-center justify-center gap-2.5 rounded-xl border border-surface-border bg-surface-raised px-4 text-[13.5px] font-medium transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? <Spinner /> : <Icon />}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
          ) : null}

          {/* Divider — pointless with nothing above it */}
          {providers.length > 0 ? (
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-surface-border" />
            <span className="text-[11px] uppercase tracking-wider text-muted">or</span>
            <span className="h-px flex-1 bg-surface-border" />
          </div>
          ) : null}

          {/* Email / password */}
          <form className="flex flex-col gap-2.5" onSubmit={(e) => void handleEmailSubmit(e)}>
            <input
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              className="app-no-drag h-11 rounded-xl border border-surface-border bg-black/20 px-3.5 text-[13.5px] outline-none transition placeholder:text-muted focus:border-accent/60 focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
            />
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder="Password"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              className="app-no-drag h-11 rounded-xl border border-surface-border bg-black/20 px-3.5 text-[13.5px] outline-none transition placeholder:text-muted focus:border-accent/60 focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy}
              className="app-no-drag mt-1 flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[13.5px] font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Spinner /> : null}
              <span>{mode === 'signup' ? 'Create account' : 'Sign in'}</span>
            </button>
          </form>

          {/* Mode toggle */}
          <p className="mt-5 text-center text-[12.5px] text-muted">
            {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMode((m) => (m === 'signup' ? 'signin' : 'signup'));
                setFormError(null);
              }}
              className="app-no-drag font-medium text-accent transition hover:text-accent-hover disabled:opacity-50"
            >
              {mode === 'signup' ? 'Sign in' : 'Create one'}
            </button>
          </p>

          {/* Browser-flow hint */}
          {authenticating && status.provider !== 'email' ? (
            <p className="mt-4 text-center text-[12px] text-muted">
              Complete sign-in in your browser, then return here.
            </p>
          ) : null}
        </motion.div>
      </main>
    </div>
  );
}
