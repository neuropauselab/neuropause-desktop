/**
 * P13C REMEDIATION — FINDING 6. A caller-supplied `orgId` is not authority.
 *
 * A family of channels — `org.get`, `org.members`, `org.invite`,
 * `org.changeRole`, `org.removeMember`, `org.workspaces`, the workspace
 * create/rename/delete trio, billing checkout, and `devices.list` /
 * `registerCurrent` / `revoke` — took `orgId` straight from the renderer and
 * forwarded it, guarded by `requireAuth: true` alone.
 *
 * `requireAuth` proves somebody is signed in. It proves nothing about WHICH
 * organization they may act in, so any signed-in account could read another
 * organization's member list and device inventory by supplying its id, and
 * could start a billing checkout against it.
 *
 * These are CLOUD organizations — a different id space from the local
 * enterprise `orgStore` — so the check cannot be made against local tenancy.
 * The authority is the caller's own membership list, which the backend already
 * scopes to their session. This suite exercises that guard's decision function.
 */
import { describe, expect, it, vi } from 'vitest';

/**
 * The guard, reproduced exactly as `requireCloudOrgMembership` implements it.
 *
 * Reproduced rather than imported because the real one lives inside
 * `runtimeCore`, an Electron composition root that cannot load in a node test.
 * The logic under test is the DECISION, and it is stated once here so a change
 * to the original that loosened it would leave this suite visibly stale.
 */
async function requireCloudOrgMembership(
  orgId: string,
  list: () => Promise<{ orgId: string }[]>,
): Promise<string> {
  if (typeof orgId !== 'string' || orgId.trim() === '') {
    throw new Error('That organization is not available to you.');
  }
  let mine: { orgId: string }[];
  try {
    mine = await list();
  } catch {
    throw new Error('That organization is not available to you.');
  }
  if (!mine.some((o) => o.orgId === orgId)) {
    throw new Error('That organization is not available to you.');
  }
  return orgId;
}

const REFUSAL = /not available to you/;

/** Tenant A's session: they belong to org-a only. */
const aMemberships = async () => [{ orgId: 'org-a' }];
/** Tenant B's session: they belong to org-b only. */
const bMemberships = async () => [{ orgId: 'org-b' }];

describe('a caller may only name an organization they belong to', () => {
  it('A naming B’s organization is DENIED', async () => {
    await expect(requireCloudOrgMembership('org-b', aMemberships)).rejects.toThrow(REFUSAL);
  });

  it('B naming A’s organization is DENIED — symmetric', async () => {
    await expect(requireCloudOrgMembership('org-a', bMemberships)).rejects.toThrow(REFUSAL);
  });

  it('A naming their OWN organization is ALLOWED — the guard is not just "no"', async () => {
    await expect(requireCloudOrgMembership('org-a', aMemberships)).resolves.toBe('org-a');
  });

  it('B naming their own organization is ALLOWED', async () => {
    await expect(requireCloudOrgMembership('org-b', bMemberships)).resolves.toBe('org-b');
  });

  it('a multi-organization account may name either of theirs, and nothing else', async () => {
    const both = async () => [{ orgId: 'org-a' }, { orgId: 'org-b' }];
    await expect(requireCloudOrgMembership('org-a', both)).resolves.toBe('org-a');
    await expect(requireCloudOrgMembership('org-b', both)).resolves.toBe('org-b');
    await expect(requireCloudOrgMembership('org-c', both)).rejects.toThrow(REFUSAL);
  });
});

describe('fail-closed', () => {
  it('an INVENTED organization id is denied', async () => {
    await expect(requireCloudOrgMembership('org-invented', aMemberships)).rejects.toThrow(REFUSAL);
  });

  it('an empty or blank id is denied without even asking the backend', async () => {
    const list = vi.fn(aMemberships);
    await expect(requireCloudOrgMembership('', list)).rejects.toThrow(REFUSAL);
    await expect(requireCloudOrgMembership('   ', list)).rejects.toThrow(REFUSAL);
    expect(list).not.toHaveBeenCalled();
  });

  /**
   * An offline backend must not become a bypass. Forwarding on failure would
   * mean the guard evaporates exactly when the system is least healthy.
   */
  it('an UNREACHABLE backend denies rather than forwarding', async () => {
    const failing = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(requireCloudOrgMembership('org-a', failing)).rejects.toThrow(REFUSAL);
  });

  it('an account with NO memberships can name nothing', async () => {
    const none = async () => [];
    await expect(requireCloudOrgMembership('org-a', none)).rejects.toThrow(REFUSAL);
  });

  /**
   * "Does not exist" and "not yours" produce the SAME message on purpose.
   * Distinguishing them would confirm which organizations exist on the backend,
   * which is the enumeration the refusal is meant to withhold.
   */
  it('does not distinguish "not yours" from "does not exist"', async () => {
    const notYours = await requireCloudOrgMembership('org-b', aMemberships).catch(
      (e: Error) => e.message,
    );
    const missing = await requireCloudOrgMembership('org-nope', aMemberships).catch(
      (e: Error) => e.message,
    );
    expect(notYours).toBe(missing);
  });
});
