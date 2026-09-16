/**
 * S144 — the federation legacy-policy MIGRATION/QUARANTINE surface goes live at the renderer.
 *
 * The four channels (`fed:gov.policyMigrationStatus` / `.quarantinedPolicies` / `.claimPolicy` /
 * `.discardPolicy`) were fully governed + tested in main (RBAC, tenant/org resolved server-side via
 * `globalGovStore.callerOrg()`, audited, fail-closed) since P13C Round 5, but had NO renderer path — the
 * quarantine could be counted by main but never resolved by a real user. S144 adds the `ipc.federation.*`
 * helpers + the FederationProvider state/actions + the GovernancePanel admin UI.
 *
 * These tests prove the renderer→secure-preload→IPC wiring the new helpers create: the correct channel is
 * dispatched with the correct payload, the id is the ONLY thing sent (no renderer-supplied tenant/org), and
 * the governed response flows back. The main-side governance (authorization, org-from-caller, fail-closed,
 * audit) is certified in `tenancy/e2e/federationLegacyMigration.test.ts` and `federationAuthz`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearRoutes, route, unroutedChannels } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';

beforeEach(() => {
  clearRoutes();
});

describe('S144 · federation policy-migration renderer wiring', () => {
  it('policyMigrationStatus dispatches the read channel and returns the count (no payload beyond {})', async () => {
    let sawPayload: unknown;
    route(IpcChannel.FedPolicyMigrationStatus, (p) => { sawPayload = p; return { migrationRequired: 3 }; });
    const r = (await ipc.federation.policyMigrationStatus()) as { migrationRequired: number };
    expect(r.migrationRequired).toBe(3);
    expect(sawPayload).toEqual({}); // status carries no arguments — it is a count, never a filter
    expect(unroutedChannels()).toEqual([]);
  });

  it('quarantinedPolicies dispatches the manage channel and returns the rows', async () => {
    route(IpcChannel.FedQuarantinedPolicies, () => [
      { id: 'p1', name: 'Legacy DENY', description: 'pre-Round-4 rule', action: 'share', effect: 'deny', scope: 'global', enabled: true },
    ]);
    const rows = (await ipc.federation.quarantinedPolicies()) as Array<{ id: string; name: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('p1');
  });

  it('claimPolicy sends ONLY the id (org is server-resolved, never renderer-supplied) and returns the outcome', async () => {
    let sawPayload: Record<string, unknown> | undefined;
    route(IpcChannel.FedClaimPolicy, (p) => { sawPayload = p as Record<string, unknown>; return { claimed: true }; });
    const r = (await ipc.federation.claimPolicy('p1')) as { claimed: boolean };
    expect(r.claimed).toBe(true);
    expect(sawPayload).toEqual({ id: 'p1' }); // the renderer supplies no org/tenant — the store uses callerOrg()
    expect('org' in (sawPayload ?? {})).toBe(false);
    expect('tenantId' in (sawPayload ?? {})).toBe(false);
  });

  it('discardPolicy sends ONLY the id and returns the boolean outcome', async () => {
    let sawPayload: Record<string, unknown> | undefined;
    route(IpcChannel.FedDiscardPolicy, (p) => { sawPayload = p as Record<string, unknown>; return { discarded: true }; });
    const r = (await ipc.federation.discardPolicy('p2')) as { discarded: boolean };
    expect(r.discarded).toBe(true);
    expect(sawPayload).toEqual({ id: 'p2' });
  });

  it('a governed refusal (claimed:false) is returned honestly, not thrown', async () => {
    route(IpcChannel.FedClaimPolicy, () => ({ claimed: false })); // e.g. no active org, or already resolved
    const r = (await ipc.federation.claimPolicy('gone')) as { claimed: boolean };
    expect(r.claimed).toBe(false);
  });
});
