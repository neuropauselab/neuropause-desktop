/** Handlers for authentication IPC. All real work lives in authService. */
import type { AuthStatus } from '@neuropause/shared';
import type { EmailCredentialsRequest, LoginOAuthRequest } from '@neuropause/shared';
import { authService } from '../../auth/authService';

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
