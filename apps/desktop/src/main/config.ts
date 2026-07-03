/**
 * Static configuration for the main process. Values can be overridden via
 * environment variables (useful for pointing the desktop app at a staging
 * backend) but always have safe local defaults.
 */
import { app } from 'electron';
import { getBakedBackendUrl } from './buildInfo';

function readUrl(name: string, fallback: string): string {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    // Validate and normalize (drops any trailing slash).
    const u = new URL(raw);
    return u.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

export const config = {
  /** Base URL of the NeuroPause backend (must match the backend's PORT). */
  backendUrl: readUrl('NEUROPAUSE_BACKEND_URL', getBakedBackendUrl() ?? 'http://127.0.0.1:4000'),

  /** How long we wait for the user to complete the browser OAuth flow. */
  oauthTimeoutMs: 5 * 60 * 1000,

  /** Refresh the access token this many ms before it actually expires. */
  accessTokenRefreshSkewMs: 60 * 1000,

  isDev: !app.isPackaged,
} as const;

export type AppConfig = typeof config;
