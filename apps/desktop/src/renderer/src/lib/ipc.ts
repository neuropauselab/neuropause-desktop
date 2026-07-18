/**
 * Strongly-typed renderer client over the preload bridge. Components import
 * `ipc` and get full type-safety; the untyped channel/payload plumbing is
 * contained entirely here.
 */
import {
  IpcChannel,
  type AppInfo,
  type AuthProviderId,
  type AuthStatus,
  type ThemeSource,
} from '@neuropause/shared';

type OAuthProviderId = Exclude<AuthProviderId, 'email'>;

export interface ThemeChangedPayload {
  source: ThemeSource;
}

const invoke = window.neuropause.invoke;
const subscribe = window.neuropause.subscribe;

export const ipc = {
  auth: {
    getStatus: () => invoke(IpcChannel.AuthGetStatus) as Promise<AuthStatus>,
    loginOAuth: (provider: OAuthProviderId) =>
      invoke(IpcChannel.AuthLoginOAuth, { provider }) as Promise<AuthStatus>,
    loginEmail: (email: string, password: string) =>
      invoke(IpcChannel.AuthLoginEmail, { email, password }) as Promise<AuthStatus>,
    registerEmail: (email: string, password: string) =>
      invoke(IpcChannel.AuthRegisterEmail, { email, password }) as Promise<AuthStatus>,
    logout: () => invoke(IpcChannel.AuthLogout) as Promise<AuthStatus>,
    onStatusChanged: (cb: (status: AuthStatus) => void) =>
      subscribe(IpcChannel.AuthStatusChanged, (p) => cb(p as AuthStatus)),
  },
  app: {
    getInfo: () => invoke(IpcChannel.AppGetInfo) as Promise<AppInfo>,
    getThemeSource: () => invoke(IpcChannel.AppGetThemeSource) as Promise<ThemeSource>,
    setThemeSource: (source: ThemeSource) =>
      invoke(IpcChannel.AppSetThemeSource, { source }) as Promise<ThemeSource>,
    onThemeChanged: (cb: (payload: ThemeChangedPayload) => void) =>
      subscribe(IpcChannel.ThemeChanged, (p) => cb(p as ThemeChangedPayload)),
  },
};
