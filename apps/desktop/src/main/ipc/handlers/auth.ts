/** Handlers for authentication IPC. All real work lives in authService. */
import type { AuthProviderId, AuthStatus } from '@neuropause/shared';
import type { EmailCredentialsRequest, LoginOAuthRequest } from '@neuropause/shared';
import { authService } from '../../auth/authService';
import { backendClient } from '../../auth/backendClient';
import { createLogger } from '../../logger';

const log = createLogger('auth-providers');

/** The OAuth providers the login screen may render. `email` is not one of them. */
const OAUTH_PROVIDERS: readonly string[] = ['google', 'github', 'microsoft', 'apple'];

/**
 * P13C F-8 — which sign-in providers the SERVER actually has configured.
 *
 * `LoginScreen.tsx:15` rendered a hardcoded array of four OAuth buttons while
 * `/auth/providers` returned `[]`, so Google, GitHub, Microsoft and Apple were
 * all offered and none could work. It was almost certainly the founder's first
 * click. `backendClient.getProviders()` already existed to answer this and had
 * NO CALLER anywhere in the main process — the correct data source was written
 * and never wired.
 *
 * A failed lookup is not an error state here. If the backend cannot be reached
 * we cannot confirm that any provider works, so we return none and the screen
 * falls back to email sign-in. That is the honest response to "I don't know",
 * and offering a button nobody can stand behind is what created F-8.
 */
export async function getProviders(): Promise<{ providers: AuthProviderId[] }> {
  try {
    const result = await backendClient.getProviders();
    const providers = (result?.providers ?? []).filter((p): p is AuthProviderId =>
      OAUTH_PROVIDERS.includes(p),
    );
    return { providers };
  } catch (err) {
    log.debug('provider list unavailable; offering none', { err: String(err) });
    return { providers: [] };
  }
}

export function getStatus(): AuthStatus {
  return authService.getStatus();
}

export function loginOAuth(payload: LoginOAuthRequest): Promise<AuthStatus> {
  return authService.loginOAuth(payload.provider);
}

export function loginEmail(payload: EmailCredentialsRequest): Promise<AuthStatus> {
  return authService.loginEmail(payload.email, payload.password);
}

export function registerEmail(payload: EmailCredentialsRequest): Promise<AuthStatus> {
  return authService.registerEmail(payload.email, payload.password);
}

export function logout(): Promise<AuthStatus> {
  return authService.logout();
}
