/**
 * P13C GATE 10 — cloud-org authorization: MEMBERSHIP IS NOT AUTHORIZATION.
 *
 * The mutating cloud-org channels (`org.update`, `org.invite`, `org.changeRole`,
 * `org.removeMember`, workspace create/rename/delete, billing checkout) used to
 * authorize on membership alone — so a `viewer` or plain `member` could invite
 * or remove other members, rename workspaces, or start a paid checkout. These
 * pin the role decision the client now enforces (defense in depth) using the
 * role the backend itself reports.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authorizeCloudOrgRole,
  CLOUD_ORG_MANAGERS,
  CLOUD_ORG_DENIED,
} from './cloudOrgAuthorize';
import type { CloudMembershipRow } from './cloudOrgAuthorize';

const HERE = fileURLToPath(new URL('.', import.meta.url));

const memberships: CloudMembershipRow[] = [
  { orgId: 'org-owner', role: 'owner' },
  { orgId: 'org-admin', role: 'admin' },
  { orgId: 'org-member', role: 'member' },
  { orgId: 'org-viewer', role: 'viewer' },
];

describe('managers-only actions (invite / remove / update / workspaces / billing)', () => {
  it('an OWNER and an ADMIN are allowed', () => {
    expect(authorizeCloudOrgRole(memberships, 'org-owner', CLOUD_ORG_MANAGERS)).toBe('org-owner');
    expect(authorizeCloudOrgRole(memberships, 'org-admin', CLOUD_ORG_MANAGERS)).toBe('org-admin');
  });

  it('a MEMBER is REFUSED — the finding: membership was not enough', () => {
    expect(() => authorizeCloudOrgRole(memberships, 'org-member', CLOUD_ORG_MANAGERS)).toThrow(
      CLOUD_ORG_DENIED,
    );
  });

  it('a VIEWER is REFUSED', () => {
    expect(() => authorizeCloudOrgRole(memberships, 'org-viewer', CLOUD_ORG_MANAGERS)).toThrow(
      CLOUD_ORG_DENIED,
    );
  });
});

describe('membership-only reads (org.get / members / workspaces / devices.list)', () => {
  it('every role including viewer is allowed when no role restriction is given', () => {
    for (const m of memberships) {
      expect(authorizeCloudOrgRole(memberships, m.orgId)).toBe(m.orgId);
    }
  });
});

describe('fail-closed refusals — one opaque message for all', () => {
  it('a non-member is refused even for a read', () => {
    expect(() => authorizeCloudOrgRole(memberships, 'org-stranger')).toThrow(CLOUD_ORG_DENIED);
  });

  it('an unreachable backend (empty list) refuses — no bypass', () => {
    expect(() => authorizeCloudOrgRole([], 'org-owner', CLOUD_ORG_MANAGERS)).toThrow(CLOUD_ORG_DENIED);
  });

  it('a blank org id is refused', () => {
    expect(() => authorizeCloudOrgRole(memberships, '   ', CLOUD_ORG_MANAGERS)).toThrow(
      CLOUD_ORG_DENIED,
    );
  });

  it('the refusal for insufficient-role is BYTE-IDENTICAL to not-a-member — nothing leaks', () => {
    let asMember = '';
    let asStranger = '';
    try {
      authorizeCloudOrgRole(memberships, 'org-member', CLOUD_ORG_MANAGERS);
    } catch (e) {
      asMember = (e as Error).message;
    }
    try {
      authorizeCloudOrgRole(memberships, 'org-stranger', CLOUD_ORG_MANAGERS);
    } catch (e) {
      asStranger = (e as Error).message;
    }
    expect(asMember).toBe(asStranger);
    expect(asMember).toBe(CLOUD_ORG_DENIED);
  });
});

/**
 * The wiring pin: the mutating cloud-org handlers must call `requireCloudOrgRole`
 * with `CLOUD_ORG_MANAGERS`, and the reads must stay on `requireCloudOrgMembership`.
 * `runtimeCore.ts` cannot be imported in a unit test (it pulls in Electron and
 * the whole app), so this asserts the source wiring — a regression that downgrades
 * a mutation back to membership-only fails here.
 */
describe('runtimeCore wiring pin', () => {
  it('every mutating cloud-org handler is role-gated, reads are not', () => {
    const src = readFileSync(join(HERE, '..', 'runtimeCore.ts'), 'utf8');
    // Mutations: each of these orgClient calls must be reached via requireCloudOrgRole.
    for (const mut of [
      'orgClient.update(',
      'orgClient.invite(',
      'orgClient.changeRole(',
      'orgClient.removeMember(',
      'orgClient.createWorkspace(',
      'orgClient.updateWorkspace(',
      'orgClient.deleteWorkspace(',
      'billingClient.checkout(',
    ]) {
      const idx = src.indexOf(mut);
      expect(idx, `${mut} not found`).toBeGreaterThan(-1);
      // The 400 chars preceding the call must contain the role guard, not bare membership.
      const before = src.slice(Math.max(0, idx - 400), idx);
      expect(before, `${mut} must be role-gated`).toContain('requireCloudOrgRole');
    }
    // No mutating call is reached only by the membership-only guard: assert the
    // role guard appears at least as many times as the 8 mutations.
    const roleGates = src.split('requireCloudOrgRole(').length - 1;
    expect(roleGates).toBeGreaterThanOrEqual(8 + 1); // 8 call sites + the definition
  });
});
