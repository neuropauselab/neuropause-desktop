/**
 * S146 — API key ROTATION goes live at the renderer.
 *
 * `ecosystem:keys.rotate` (IpcChannel.EcosystemKeysRotate) was fully governed in main since P3.0 —
 * RBAC `developer:manage`, `audit: true`, owner/tenant resolved server-side (the store's `mineOrNull`
 * resolves ownership before mutating, so one tenant can never rotate another's key), minting a fresh
 * secret and revoking the old id atomically — but had NO renderer path: an operator could create and
 * revoke keys yet never rotate a possibly-leaked one without downtime. S146 adds the
 * `ipc.ecosystem.rotateKey` helper, the DeveloperProvider action, and the "Rotate" control on the
 * ApiKeysPanel (revealing the new secret through the same one-time modal as creation).
 *
 * These tests prove the renderer→secure-preload→IPC wiring the new helper creates: the correct channel
 * is dispatched with ONLY the key id (no renderer-supplied tenant/org — ownership is server-resolved),
 * the returned one-time secret flows back, and a governed refusal ({ error }) is returned honestly, not
 * thrown. The main-side governance (authorization, owner-from-caller, atomic revoke, audit) is certified
 * in `tenancy/e2e/developerSurfaceTenancy.test.ts` and `ecosystemAuthz`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearRoutes, route, unroutedChannels } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';

beforeEach(() => {
  clearRoutes();
});

describe('S146 · ecosystem key-rotation renderer wiring', () => {
  it('rotateKey dispatches ecosystem:keys.rotate with ONLY the id and returns the new secret once', async () => {
    let sawPayload: Record<string, unknown> | undefined;
    route(IpcChannel.EcosystemKeysRotate, (p) => {
      sawPayload = p as Record<string, unknown>;
      return { key: { id: 'k2', name: 'CI', prefix: 'np_', last4: 'ab12', scopes: ['marketplace:read'], revokedAt: null }, secret: 'np_live_rotated_secret' };
    });
    const r = (await ipc.ecosystem.rotateKey('k1')) as { key: { id: string }; secret: string };
    expect(r.secret).toBe('np_live_rotated_secret');
    expect(r.key.id).toBe('k2');
    expect(sawPayload).toEqual({ id: 'k1' }); // ONLY the id — tenant/owner resolved server-side
    expect('tenantId' in (sawPayload ?? {})).toBe(false);
    expect('orgId' in (sawPayload ?? {})).toBe(false);
    expect('developerId' in (sawPayload ?? {})).toBe(false);
    expect(unroutedChannels()).toEqual([]);
  });

  it('returns a governed refusal ({ error }) honestly, not thrown (unknown/revoked/other-tenant key)', async () => {
    route(IpcChannel.EcosystemKeysRotate, () => ({ error: 'not_found', error_description: 'No such active key.' }));
    const r = (await ipc.ecosystem.rotateKey('gone')) as { error: string };
    expect(r.error).toBe('not_found');
  });
});
