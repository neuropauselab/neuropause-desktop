/**
 * Static configuration for the main process. Values can be overridden via
 * environment variables (useful for pointing the desktop app at a staging
 * backend) but always have safe local defaults.
 */
import { app } from 'electron';
import { getBakedBackendUrl } from './buildInfo';

const LOCAL_BACKEND_URL = 'http://127.0.0.1:4000';

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

/**
 * The default backend URL for this run, before NEUROPAUSE_BACKEND_URL is applied.
 *
 * A PACKAGED build uses the URL baked at package time — that is the whole point
 * of baking it. An UNPACKAGED (dev) run must not, and this is not theoretical:
 * `scripts/generate-build-info.cjs` writes `resources/build-info.json` during
 * packaging and leaves it in the working tree afterwards. It is gitignored, so it
 * never shows up in `git status`, and `buildInfo.readGenerated()` finds it via
 * `app.getAppPath()` in dev exactly as it does in a packaged build.
 *
 * Consequence, reproduced 13 Aug 2026 on a tree that had run `npm run package:win`:
 * `npm run dev` logged `Starting in development mode { backendUrl:
 * 'https://api.neuropause033.com' }`. A developer running a local backend on
 * :4000 would have been silently authenticating against production.
 *
 * A dev run therefore defaults to the local backend. `NEUROPAUSE_BACKEND_URL`
 * still overrides in both modes, which is the supported way to point a dev run
 * at staging or production.
 */
function defaultBackendUrl(): string {
  if (!app.isPackaged) return LOCAL_BACKEND_URL;
  return getBakedBackendUrl() ?? LOCAL_BACKEND_URL;
}

export const config = {
  /** Base URL of the NeuroPause backend (must match the backend's PORT). */
  backendUrl: readUrl('NEUROPAUSE_BACKEND_URL', defaultBackendUrl()),

  /** How long we wait for the user to complete the browser OAuth flow. */
  oauthTimeoutMs: 5 * 60 * 1000,

  /** Refresh the access token this many ms before it actually expires. */
  accessTokenRefreshSkewMs: 60 * 1000,

  isDev: !app.isPackaged,
} as const;

export type AppConfig = typeof config;
