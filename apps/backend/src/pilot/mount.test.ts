/**
 * ENG-09 §12 — the pilot surface must not exist merely because the process is running.
 *
 * These drive `decidePilotMount` directly with a stubbed environment resolver, so every
 * refusal path is reachable without a database. The two-sided identity check itself is pinned
 * against real Postgres in `src/__integration__/pilotGovernanceControls.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const resolve = vi.hoisted(() => vi.fn());
vi.mock('./environment', () => ({ resolvePilotEnvironment: resolve }));

import { decidePilotMount, createPilotMountGate } from './mount';

const OK = {
  ok: true as const,
  record: { environmentClass: 'PILOT', environmentId: 'E1', targetClass: 'PILOT', targetId: 'T1',
            applicationVersion: 'x', configurationDigest: 'd', establishedAt: 'now' },
};
const ENABLED = { PILOT_MODULE_ENABLED: 'true' } as NodeJS.ProcessEnv;

beforeEach(() => { resolve.mockReset(); resolve.mockResolvedValue(OK); });
afterEach(() => { vi.restoreAllMocks(); });

describe('§12 — every refusal path', () => {
  it('TEST 3: no PILOT_MODULE_ENABLED -> refused, and the environment is never consulted', async () => {
    const d = await decidePilotMount({} as NodeJS.ProcessEnv);
    expect(d).toEqual({ mounted: false, reason: 'PILOT_MODULE_NOT_ENABLED' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(['', ' ', '1', 'yes', 'TRUE', 'True', 'false', 'enabled'])(
    'PILOT_MODULE_ENABLED=%j is NOT an opt-in — only the literal "true" is',
    async (value) => {
      const d = await decidePilotMount({ PILOT_MODULE_ENABLED: value } as NodeJS.ProcessEnv);
      expect(d).toEqual({ mounted: false, reason: 'PILOT_MODULE_NOT_ENABLED' });
    });

  it('TEST 1: no environment identity -> refused', async () => {
    resolve.mockResolvedValue({ ok: false, reason: 'TARGET_IDENTITY_ABSENT' });
    expect(await decidePilotMount(ENABLED)).toEqual({ mounted: false, reason: 'TARGET_IDENTITY_ABSENT' });
  });

  it('TEST 2: environment class PRODUCTION -> refused', async () => {
    resolve.mockResolvedValue({ ok: false, reason: 'ENVIRONMENT_CLASS_NOT_PILOT' });
    expect(await decidePilotMount(ENABLED)).toEqual({ mounted: false, reason: 'ENVIRONMENT_CLASS_NOT_PILOT' });
  });

  it('TEST 4: mismatched configuration/database identity -> refused', async () => {
    resolve.mockResolvedValue({ ok: false, reason: 'TARGET_IDENTITY_MISMATCH' });
    expect(await decidePilotMount(ENABLED)).toEqual({ mounted: false, reason: 'TARGET_IDENTITY_MISMATCH' });
  });

  it('TEST 6: enabled + established identity -> mounted (and this authorizes NO execution)', async () => {
    const d = await decidePilotMount(ENABLED);
    expect(d.mounted).toBe(true);
  });
});

describe('§11 — a production-like configuration cannot activate the pilot with a string', () => {
  it('setting every env var but failing the DATABASE assertion still refuses', async () => {
    resolve.mockResolvedValue({ ok: false, reason: 'TARGET_IDENTITY_ABSENT' });
    const d = await decidePilotMount({
      PILOT_MODULE_ENABLED: 'true', PILOT_ENVIRONMENT_CLASS: 'PILOT',
      PILOT_ENVIRONMENT_ID: 'looks-real', PILOT_TARGET_ID: 'looks-real',
    } as NodeJS.ProcessEnv);
    expect(d).toEqual({ mounted: false, reason: 'TARGET_IDENTITY_ABSENT' });
  });
});

describe('the gate', () => {
  const runGate = (env: NodeJS.ProcessEnv) =>
    new Promise<string>((done) => {
      const gate = createPilotMountGate(env);
      gate({} as never, {} as never, ((arg?: unknown) => done(arg === 'router' ? 'REFUSED' : 'ALLOWED')) as never);
    });

  it('refuses by abandoning the router stack, so the ordinary 404 answers', async () => {
    expect(await runGate({} as NodeJS.ProcessEnv)).toBe('REFUSED');
  });

  it('allows when the decision permits', async () => {
    expect(await runGate(ENABLED)).toBe('ALLOWED');
  });

  it('an ERROR in the decision refuses — an outage is not permission', async () => {
    resolve.mockRejectedValue(new Error('database unreachable'));
    expect(await runGate(ENABLED)).toBe('REFUSED');
  });

  it('memoizes: the decision is evaluated once, not per request', async () => {
    const gate = createPilotMountGate(ENABLED);
    const fire = () => new Promise<void>((done) => gate({} as never, {} as never, (() => done()) as never));
    await fire(); await fire(); await fire();
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
