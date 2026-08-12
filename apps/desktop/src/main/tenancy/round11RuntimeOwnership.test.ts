/**
 * P13C ROUND 11 — M-1 / M-2 / M-3. A RUNNING PROCESS HAS AN OWNER.
 *
 * THE FINDING, IN THREE PARTS THAT SHARE ONE ROOT.
 *
 * `RuntimeInstance` carried no owner at all. The catalogue row an app launches
 * FROM is legitimately INSTALL_GLOBAL — one copy on one machine — and that fact
 * was quietly inherited by the live process, which is a different object with a
 * different audience.
 *
 *   M-3  `list()` returned every instance on the install, and
 *        `requireInstance(instanceId)` — behind stop / suspend / resume /
 *        restart — resolved a renderer-supplied id with NO ownership comparison.
 *        So a Manager in organization A could enumerate organization B's
 *        processes and then stop them.
 *
 *   M-1  `runtime:list` was in `PUBLIC_CHANNELS`: no auth, no permission.
 *   M-2  `runtime:health` likewise, and it returns the same DTO.
 *
 * WHAT THE DTO CARRIES, because "it's just a list" is the argument that kept it
 * public: `appSlug`, `pid`, `startedAt`, `uptimeMs`, `restarts` and a CPU/memory
 * sample, per live process. An instance count that climbs while you are idle is
 * another organization launching something and `appSlug` names what.
 *
 * THE TWO HALVES ARE NOT INTERCHANGEABLE, which is why both are asserted here.
 * The channel gate establishes that the caller is a signed-in member of SOME
 * organization; only the owner filter establishes WHICH processes are theirs.
 * Gating alone would have left every member of every tenant reading the whole
 * install.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TenantScope } from '@neuropause/shared';

const MAIN = join(fileURLToPath(new URL('.', import.meta.url)), '..');

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getAppMetrics: () => [] },
}));

/** A registry that knows one installed web app, and records nothing. */
vi.mock('../registry/registry', () => ({
  registry: {
    getRaw: (slug: string) => ({
      slug,
      name: `App ${slug}`,
      appType: 'web' as const,
      config: {},
    }),
    recordLaunch: async () => undefined,
    setRuntimeStatus: async () => undefined,
    setHealth: async () => undefined,
  },
}));

vi.mock('../catalog/catalogClient', () => ({
  catalogClient: {
    app: async () => ({ launchUrl: 'https://example.test', homepageUrl: null }),
    recordLaunch: async () => undefined,
  },
}));

const { supervisor } = await import('../runtime/supervisor');

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };
const C: TenantScope = { tenantId: 'org-c', workspaceId: 'ws-c' };

let who: TenantScope | null = null;
supervisor.bindScope(() => who);

/** Launch `n` instances of `slug` as `scope`, returning their ids. */
async function launchAs(scope: TenantScope | null, slug: string, n: number): Promise<string[]> {
  who = scope;
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) ids.push((await supervisor.launch(slug)).instanceId);
  who = null;
  return ids;
}

/** Remove everything, so each case starts from a known install. */
async function drain(): Promise<void> {
  for (const scope of [A, B, C, null]) {
    who = scope;
    for (const i of supervisor.list()) await supervisor.stop(i.instanceId);
  }
  who = null;
}

beforeEach(async () => {
  await drain();
});

describe('A/B/C each see only their own live processes', () => {
  it('A owns 2, B owns 3, C owns 4 — the counts, and the identities', async () => {
    const a = await launchAs(A, 'alpha-app', 2);
    const b = await launchAs(B, 'beta-app', 3);
    const c = await launchAs(C, 'gamma-app', 4);

    who = A;
    expect(supervisor.list().map((i) => i.instanceId).sort()).toEqual([...a].sort());
    who = B;
    expect(supervisor.list().map((i) => i.instanceId).sort()).toEqual([...b].sort());
    who = C;
    expect(supervisor.list().map((i) => i.instanceId).sort()).toEqual([...c].sort());

    // And the slug — the field that names WHAT another tenant is running.
    who = A;
    expect(supervisor.list().every((i) => i.appSlug === 'alpha-app')).toBe(true);
  });

  it('an unresolved caller sees NOTHING that belongs to a tenant', async () => {
    await launchAs(A, 'alpha-app', 2);
    who = null;
    expect(supervisor.list()).toEqual([]);
  });

  it('a single-user install (no tenant) still sees its own instances', async () => {
    // `unowned-install` is one audience, not a shared one — the desktop with no
    // organization must remain usable.
    const own = await launchAs(null, 'solo-app', 2);
    who = null;
    expect(supervisor.list().map((i) => i.instanceId).sort()).toEqual([...own].sort());
  });
});

describe('no tenant may reach another tenant’s process', () => {
  it('B cannot read A’s instance through get()', async () => {
    const [a0] = await launchAs(A, 'alpha-app', 1);
    who = B;
    expect(supervisor.get(a0!)).toBeNull();
    who = A;
    expect(supervisor.get(a0!)?.instanceId).toBe(a0);
  });

  it('B cannot stop, suspend, resume or restart A’s instance', async () => {
    const [a0] = await launchAs(A, 'alpha-app', 1);
    who = B;
    await expect(supervisor.stop(a0!)).rejects.toThrow(/No runtime instance/);
    await expect(supervisor.suspend(a0!)).rejects.toThrow(/No runtime instance/);
    await expect(supervisor.resume(a0!)).rejects.toThrow(/No runtime instance/);
    await expect(supervisor.restart(a0!)).rejects.toThrow(/No runtime instance/);

    // Survives, and is still A's, still running.
    who = A;
    expect(supervisor.get(a0!)).not.toBeNull();
  });

  it('C cannot stop A’s or B’s instances', async () => {
    const [a0] = await launchAs(A, 'alpha-app', 1);
    const [b0] = await launchAs(B, 'beta-app', 1);
    who = C;
    await expect(supervisor.stop(a0!)).rejects.toThrow(/No runtime instance/);
    await expect(supervisor.stop(b0!)).rejects.toThrow(/No runtime instance/);
    who = A;
    expect(supervisor.get(a0!)).not.toBeNull();
    who = B;
    expect(supervisor.get(b0!)).not.toBeNull();
  });

  it('each tenant CAN control its own — the gate is not "always no"', async () => {
    const [a0] = await launchAs(A, 'alpha-app', 1);
    who = A;
    expect((await supervisor.suspend(a0!)).status).toBe('suspended');
    expect((await supervisor.resume(a0!)).status).toBe('running');
    await supervisor.stop(a0!);
    expect(supervisor.get(a0!)).toBeNull();
  });
});

describe('the refusal does not confirm that the process exists', () => {
  /**
   * THE INFERENCE HALF OF M-3. Instance ids are UUIDs, so a message that
   * distinguishes "not yours" from "no such thing" turns a guessed id into an
   * existence oracle — and the DTO behind it names the app. One message.
   */
  it('a real foreign id and an invented id fail identically', async () => {
    const [a0] = await launchAs(A, 'alpha-app', 1);
    who = B;

    const foreign = await supervisor.stop(a0!).catch((e: Error) => e.message);
    const invented = await supervisor
      .stop('11111111-2222-3333-4444-555555555555')
      .catch((e: Error) => e.message);

    // Same shape, and neither says "forbidden" / "not yours".
    expect(foreign.replace(a0!, '<id>')).toBe(
      invented.replace('11111111-2222-3333-4444-555555555555', '<id>'),
    );
    expect(foreign).not.toMatch(/permission|forbidden|not yours|another|denied/i);
  });
});

describe('the channels that expose this are classified, not public', () => {
  it('runtime:list and runtime:health are gated and NOT on the public allowlist', async () => {
    const { RUNTIME_CHANNEL_PERMISSIONS, PUBLIC_CHANNELS } = await import('../ipc/runtimeAuthz');
    const { IpcChannel } = await import('@neuropause/shared');

    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.RuntimeList]).toBe('operations:read');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.RuntimeHealth]).toBe('operations:read');
    expect(PUBLIC_CHANNELS.has(IpcChannel.RuntimeList)).toBe(false);
    expect(PUBLIC_CHANNELS.has(IpcChannel.RuntimeHealth)).toBe(false);
  });

  it('neither is BOTH public and gated — the NEW-M8 blindness', async () => {
    const { channelsBothPublicAndGated, RUNTIME_CHANNEL_PERMISSIONS, PUBLIC_CHANNELS } =
      await import('../ipc/runtimeAuthz');
    const gated = Object.keys(RUNTIME_CHANNEL_PERMISSIONS).map((c) => ({ channel: c }));
    expect(
      channelsBothPublicAndGated(gated as never, PUBLIC_CHANNELS),
      'a channel on the allowlist AND behind a gate makes assertAllChannelsClassified blind to it',
    ).toEqual([]);
  });
});

describe('the composition root attaches the seam', () => {
  /**
   * Pinned by name, like `orgStore` and the 106 module stores in
   * `resolverAttachment.test.ts`. An unbound supervisor answers
   * `unowned-install` for everyone, which is exactly the shared-audience state
   * this finding was — so "nobody bound it" must not be reachable silently.
   */
  it('runtimeCore binds the supervisor to the principal-aware resolver', () => {
    const src = readFileSync(join(MAIN, 'runtimeCore.ts'), 'utf8');
    expect(src).toContain('supervisor.bindScope(activeTenantScope)');
    expect(
      /supervisor\.bindScope\(\s*\(\)\s*=>\s*tenantContext\.scope\(\)\s*\)/.test(src),
      'the session-only resolver would hand a companion device the tenant on screen',
    ).toBe(false);
  });
});
