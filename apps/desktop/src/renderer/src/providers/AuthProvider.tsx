import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthProviderId, AuthStatus } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';

type OAuthProviderId = Exclude<AuthProviderId, 'email'>;

interface AuthContextValue {
  status: AuthStatus;
  /** True until we've learned the initial status from the main process. */
  initializing: boolean;
  loginOAuth: (provider: OAuthProviderId) => Promise<AuthStatus>;
  loginEmail: (email: string, password: string) => Promise<AuthStatus>;
  registerEmail: (email: string, password: string) => Promise<AuthStatus>;
  logout: () => Promise<AuthStatus>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>({ state: 'unauthenticated' });
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let active = true;
    // Seed with the current status, then keep it live via broadcasts.
    void ipc.auth
      .getStatus()
      .then((s) => {
        if (active) setStatus(s);
      })
      .finally(() => {
        if (active) setInitializing(false);
      });

    const unsubscribe = ipc.auth.onStatusChanged((s) => setStatus(s));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const loginOAuth = useCallback((provider: OAuthProviderId) => ipc.auth.loginOAuth(provider), []);
  const loginEmail = useCallback(
    (email: string, password: string) => ipc.auth.loginEmail(email, password),
    [],
  );
  const registerEmail = useCallback(
    (email: string, password: string) => ipc.auth.registerEmail(email, password),
    [],
  );
  const logout = useCallback(() => ipc.auth.logout(), []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, initializing, loginOAuth, loginEmail, registerEmail, logout }),
    [status, initializing, loginOAuth, loginEmail, registerEmail, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
