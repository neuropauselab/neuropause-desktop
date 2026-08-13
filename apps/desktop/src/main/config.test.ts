/**
 * F-6 regression lock — a dev run must never inherit the packaged backend URL.
 *
 * `scripts/generate-build-info.cjs` writes `apps/desktop/resources/build-info.json`
 * at package time and leaves it in the working tree. The file is gitignored, so it
 * is invisible to `git status`, and `buildInfo.readGenerated()` resolves it in dev
 * through `app.getAppPath()` exactly as in a packaged build.
 *
 * Reproduced 13 Aug 2026 before this fix: `npm run dev` on a tree that had run
 * `npm run package:win` logged
 *   `Starting in development mode { backendUrl: 'https://api.neuropause033.com' }`
 * while a local backend was listening on :4000.
 *
 * Negative control: revert `defaultBackendUrl()` in config.ts to
 * `getBakedBackendUrl() ?? 'http://127.0.0.1:4000'` and the first case below must
 * FAIL with the production URL. If it still passes, this test proves nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BAKED = 'https://api.neuropause033.com';
const LOCAL = 'http://127.0.0.1:4000';

const mockState = vi.hoisted(() => ({ packaged: false, baked: null as string | null }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockState.packaged;
    },
  },
}));

vi.mock('./buildInfo', () => ({
  getBakedBackendUrl: () => mockState.baked,
}));

async function loadConfig(): Promise<{ backendUrl: string; isDev: boolean }> {
  vi.resetModules();
  const mod = await import('./config');
  return mod.config;
}

const savedEnv = process.env['NEUROPAUSE_BACKEND_URL'];

beforeEach(() => {
  delete process.env['NEUROPAUSE_BACKEND_URL'];
  mockState.packaged = false;
  mockState.baked = null;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env['NEUROPAUSE_BACKEND_URL'];
  else process.env['NEUROPAUSE_BACKEND_URL'] = savedEnv;
});

describe('config.backendUrl', () => {
  it('a dev run ignores a leftover baked URL and stays local', async () => {
    mockState.packaged = false;
    mockState.baked = BAKED; // resources/build-info.json survived a package run
    const config = await loadConfig();
    expect(config.backendUrl).toBe(LOCAL);
    expect(config.isDev).toBe(true);
  });

  it('a packaged build uses the baked URL — that is what baking is for', async () => {
    mockState.packaged = true;
    mockState.baked = BAKED;
    const config = await loadConfig();
    expect(config.backendUrl).toBe(BAKED);
    expect(config.isDev).toBe(false);
  });

  it('a packaged build with nothing baked falls back to local', async () => {
    mockState.packaged = true;
    mockState.baked = null;
    const config = await loadConfig();
    expect(config.backendUrl).toBe(LOCAL);
  });

  it('NEUROPAUSE_BACKEND_URL still overrides a dev run', async () => {
    mockState.packaged = false;
    mockState.baked = BAKED;
    process.env['NEUROPAUSE_BACKEND_URL'] = 'http://127.0.0.1:5555';
    const config = await loadConfig();
    expect(config.backendUrl).toBe('http://127.0.0.1:5555');
  });

  it('NEUROPAUSE_BACKEND_URL still overrides a packaged build', async () => {
    mockState.packaged = true;
    mockState.baked = BAKED;
    process.env['NEUROPAUSE_BACKEND_URL'] = 'https://staging.example.com/';
    const config = await loadConfig();
    // trailing slash normalized away
    expect(config.backendUrl).toBe('https://staging.example.com');
  });

  it('a malformed override does not win — it falls back to the mode default', async () => {
    mockState.packaged = true;
    mockState.baked = BAKED;
    process.env['NEUROPAUSE_BACKEND_URL'] = 'not a url';
    const config = await loadConfig();
    expect(config.backendUrl).toBe(BAKED);
  });
});
