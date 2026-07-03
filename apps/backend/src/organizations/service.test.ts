import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryOrgRepository } from './memoryRepository';
import type { OrgRepository } from './types';
import type { OrgErrorCode } from './service';
import {
  acceptInvite,
  changeRole,
  createOrganization,
  createWorkspace,
  deleteWorkspace,
  getOrganization,
  inviteMember,
  listMembers,
  listWorkspaces,
  removeMember,
  updateOrganization,
  updateWorkspace,
} from './service';

const OWNER = 'user-owner';

let repo: OrgRepository;
beforeEach(() => {
  repo = createMemoryOrgRepository();
});

async function seedOrg(name = 'Acme'): Promise<{ orgId: string }> {
  const { organization } = await createOrganization(repo, { name, ownerUserId: OWNER });
  return { orgId: organization.id };
}

async function expectCode(p: Promise<unknown>, code: OrgErrorCode): Promise<void> {
  await expect(p).rejects.toMatchObject({ name: 'OrgError', code });
}

describe('createOrganization', () => {
  it('creates the org and seats the creator as an active owner', async () => {
    const { organization, membership } = await createOrganization(repo, {
      name: 'Acme Inc',
      ownerUserId: OWNER,
    });
    expect(organization.slug).toBe('acme-inc');
    expect(membership.role).toBe('owner');
    expect(membership.status).toBe('active');
    expect(membership.userId).toBe(OWNER);
  });

  it('auto-suffixes a generated slug when it collides', async () => {
    const a = await createOrganization(repo, { name: 'Dup', ownerUserId: OWNER });
    const b = await createOrganization(repo, { name: 'Dup', ownerUserId: 'u2' });
    expect(a.organization.slug).toBe('dup');
    expect(b.organization.slug).not.toBe('dup');
    expect(b.organization.slug.startsWith('dup-')).toBe(true);
  });

  it('rejects an explicitly requested slug that is taken', async () => {
    await createOrganization(repo, { name: 'One', slug: 'team', ownerUserId: OWNER });
    await expectCode(
      createOrganization(repo, { name: 'Two', slug: 'team', ownerUserId: 'u2' }),
      'conflict',
    );
  });

  it('rejects an empty name', async () => {
    await expectCode(createOrganization(repo, { name: '   ', ownerUserId: OWNER }), 'invalid');
  });
});

describe('inviteMember + acceptInvite', () => {
  it('invites a member and returns a one-time token; the invite is pending', async () => {
    const { orgId } = await seedOrg();
    const { membership, token } = await inviteMember(repo, {
      orgId,
      actorUserId: OWNER,
      email: 'New@Example.com',
      role: 'member',
    });
    expect(token).toHaveLength(43); // 32 random bytes, base64url
    expect(membership.status).toBe('invited');
    expect(membership.userId).toBeNull();
    expect(membership.invitedEmail).toBe('new@example.com');
  });

  it('accepts an invite, binding it to the user as active', async () => {
    const { orgId } = await seedOrg();
    const { token } = await inviteMember(repo, {
      orgId,
      actorUserId: OWNER,
      email: 'a@b.com',
      role: 'admin',
    });
    const m = await acceptInvite(repo, { token, userId: 'user-new', userEmail: 'a@b.com' });
    expect(m.status).toBe('active');
    expect(m.role).toBe('admin');
    expect(m.userId).toBe('user-new');
    expect(m.invitedEmail).toBeNull();
    // token is single-use now
    await expectCode(
      acceptInvite(repo, { token, userId: 'user-new', userEmail: 'a@b.com' }),
      'invalid',
    );
  });

  it('rejects a duplicate pending invite for the same email', async () => {
    const { orgId } = await seedOrg();
    await inviteMember(repo, { orgId, actorUserId: OWNER, email: 'dup@x.com', role: 'member' });
    await expectCode(
      inviteMember(repo, { orgId, actorUserId: OWNER, email: 'dup@x.com', role: 'member' }),
      'conflict',
    );
  });

  it('forbids a non-manager (member/viewer) from inviting', async () => {
    const { orgId } = await seedOrg();
    // seat a plain member directly
    await repo.createMembership({
      orgId,
      userId: 'plain',
      role: 'member',
      status: 'active',
      invitedEmail: null,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      invitedBy: null,
    });
    await expectCode(
      inviteMember(repo, { orgId, actorUserId: 'plain', email: 'x@y.com', role: 'member' }),
      'forbidden',
    );
  });

  it('only an owner may invite another owner', async () => {
    const { orgId } = await seedOrg();
    await repo.createMembership({
      orgId,
      userId: 'admin',
      role: 'admin',
      status: 'active',
      invitedEmail: null,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      invitedBy: null,
    });
    await expectCode(
      inviteMember(repo, { orgId, actorUserId: 'admin', email: 'o@x.com', role: 'owner' }),
      'forbidden',
    );
    // owner can
    const ok = await inviteMember(repo, {
      orgId,
      actorUserId: OWNER,
      email: 'o@x.com',
      role: 'owner',
    });
    expect(ok.membership.role).toBe('owner');
  });

  it('rejects an invalid email', async () => {
    const { orgId } = await seedOrg();
    await expectCode(
      inviteMember(repo, { orgId, actorUserId: OWNER, email: 'not-an-email', role: 'member' }),
      'invalid',
    );
  });

  it('rejects an expired invite', async () => {
    const { orgId } = await seedOrg();
    const { token, membership } = await inviteMember(repo, {
      orgId,
      actorUserId: OWNER,
      email: 'e@x.com',
      role: 'member',
    });
    await repo.updateMembership(membership.id, {
      inviteExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expectCode(acceptInvite(repo, { token, userId: 'u', userEmail: 'e@x.com' }), 'expired');
  });

  it('rejects accepting with a mismatched email', async () => {
    const { orgId } = await seedOrg();
    const { token } = await inviteMember(repo, {
      orgId,
      actorUserId: OWNER,
      email: 'right@x.com',
      role: 'member',
    });
    await expectCode(
      acceptInvite(repo, { token, userId: 'u', userEmail: 'wrong@x.com' }),
      'forbidden',
    );
  });

  it('rejects an unknown token', async () => {
    await seedOrg();
    await expectCode(
      acceptInvite(repo, { token: 'garbage', userId: 'u', userEmail: 'a@b.com' }),
      'invalid',
    );
  });
});

describe('listMembers', () => {
  it('lists members for any active member', async () => {
    const { orgId } = await seedOrg();
    const members = await listMembers(repo, orgId, OWNER);
    expect(members).toHaveLength(1);
    expect(members[0]!.role).toBe('owner');
  });

  it('forbids a non-member', async () => {
    const { orgId } = await seedOrg();
    await expectCode(listMembers(repo, orgId, 'stranger'), 'forbidden');
  });
});

describe('changeRole', () => {
  async function seedWithAdmin(): Promise<{ orgId: string; adminMembershipId: string }> {
    const { orgId } = await seedOrg();
    const m = await repo.createMembership({
      orgId,
      userId: 'admin',
      role: 'admin',
      status: 'active',
      invitedEmail: null,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      invitedBy: null,
    });
    return { orgId, adminMembershipId: m.id };
  }

  it('lets an owner promote an admin to owner', async () => {
    const { orgId, adminMembershipId } = await seedWithAdmin();
    const updated = await changeRole(repo, {
      orgId,
      actorUserId: OWNER,
      membershipId: adminMembershipId,
      role: 'owner',
    });
    expect(updated.role).toBe('owner');
  });

  it('prevents demoting the last owner', async () => {
    const { orgId } = await seedOrg();
    const ownerMembership = (await listMembers(repo, orgId, OWNER))[0]!;
    await expectCode(
      changeRole(repo, {
        orgId,
        actorUserId: OWNER,
        membershipId: ownerMembership.id,
        role: 'admin',
      }),
      'conflict',
    );
  });

  it('forbids an admin from changing an owner’s role', async () => {
    const { orgId, adminMembershipId } = await seedWithAdmin();
    const ownerMembership = (await listMembers(repo, orgId, OWNER)).find(
      (m) => m.role === 'owner',
    )!;
    void adminMembershipId;
    await expectCode(
      changeRole(repo, {
        orgId,
        actorUserId: 'admin',
        membershipId: ownerMembership.id,
        role: 'admin',
      }),
      'forbidden',
    );
  });
});

describe('removeMember', () => {
  it('prevents removing the last owner', async () => {
    const { orgId } = await seedOrg();
    const ownerMembership = (await listMembers(repo, orgId, OWNER))[0]!;
    await expectCode(
      removeMember(repo, { orgId, actorUserId: OWNER, membershipId: ownerMembership.id }),
      'conflict',
    );
  });

  it('lets an owner remove a member', async () => {
    const { orgId } = await seedOrg();
    const m = await repo.createMembership({
      orgId,
      userId: 'member',
      role: 'member',
      status: 'active',
      invitedEmail: null,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      invitedBy: null,
    });
    await removeMember(repo, { orgId, actorUserId: OWNER, membershipId: m.id });
    expect(await repo.getMembershipById(m.id)).toBeNull();
  });
});

describe('workspaces', () => {
  it('creates and lists a workspace for a manager', async () => {
    const { orgId } = await seedOrg();
    const ws = await createWorkspace(repo, { orgId, actorUserId: OWNER, name: 'Research' });
    expect(ws.name).toBe('Research');
    const list = await listWorkspaces(repo, orgId, OWNER);
    expect(list.map((w) => w.id)).toContain(ws.id);
  });

  it('forbids a non-member from listing workspaces', async () => {
    const { orgId } = await seedOrg();
    await expectCode(listWorkspaces(repo, orgId, 'stranger'), 'forbidden');
  });
});

describe('listMembers — identity enrichment', () => {
  it('resolves member email and display name from the user directory', async () => {
    const r = createMemoryOrgRepository({
      users: [
        { id: OWNER, email: 'owner@np.test', displayName: 'Owner Person' },
        { id: 'user-new', email: 'invitee@np.test' },
      ],
    });
    const { organization } = await createOrganization(r, { name: 'Ident Co', ownerUserId: OWNER });
    const { token } = await inviteMember(r, {
      orgId: organization.id,
      actorUserId: OWNER,
      email: 'invitee@np.test',
      role: 'member',
    });
    await acceptInvite(r, { token, userId: 'user-new', userEmail: 'invitee@np.test' });

    const members = await listMembers(r, organization.id, OWNER);
    const owner = members.find((m) => m.userId === OWNER);
    const invitee = members.find((m) => m.userId === 'user-new');
    expect(owner?.userEmail).toBe('owner@np.test');
    expect(owner?.userDisplayName).toBe('Owner Person');
    expect(invitee?.userEmail).toBe('invitee@np.test');
    expect(invitee?.userDisplayName).toBeNull();
  });

  it('leaves identity null for a still-pending invitation', async () => {
    const r = createMemoryOrgRepository({ users: [{ id: OWNER, email: 'owner@np.test' }] });
    const { organization } = await createOrganization(r, {
      name: 'Pending Co',
      ownerUserId: OWNER,
    });
    await inviteMember(r, {
      orgId: organization.id,
      actorUserId: OWNER,
      email: 'pending@np.test',
      role: 'viewer',
    });
    const members = await listMembers(r, organization.id, OWNER);
    const pending = members.find((m) => m.status === 'invited');
    expect(pending?.userEmail).toBeNull();
    expect(pending?.invitedEmail).toBe('pending@np.test');
  });
});

describe('getOrganization + updateOrganization', () => {
  it('lets an active member read the profile', async () => {
    const { orgId } = await seedOrg('Profile Co');
    const org = await getOrganization(repo, orgId, OWNER);
    expect(org.name).toBe('Profile Co');
  });

  it('forbids a non-member from reading the profile', async () => {
    const { orgId } = await seedOrg();
    await expectCode(getOrganization(repo, orgId, 'stranger'), 'forbidden');
  });

  it('lets an owner rename the organization', async () => {
    const { orgId } = await seedOrg('Old Name');
    const updated = await updateOrganization(repo, { orgId, actorUserId: OWNER, name: 'New Name' });
    expect(updated.name).toBe('New Name');
    expect((await getOrganization(repo, orgId, OWNER)).name).toBe('New Name');
  });

  it('forbids a plain member from renaming', async () => {
    const { orgId } = await seedOrg();
    const { token } = await inviteMember(repo, {
      orgId,
      actorUserId: OWNER,
      email: 'm@x.com',
      role: 'member',
    });
    await acceptInvite(repo, { token, userId: 'plain', userEmail: 'm@x.com' });
    await expectCode(
      updateOrganization(repo, { orgId, actorUserId: 'plain', name: 'Nope' }),
      'forbidden',
    );
  });

  it('rejects a blank name and an unknown org', async () => {
    const { orgId } = await seedOrg();
    await expectCode(
      updateOrganization(repo, { orgId, actorUserId: OWNER, name: '   ' }),
      'invalid',
    );
    await expectCode(getOrganization(repo, 'no-such-org', OWNER), 'forbidden');
  });
});

describe('updateWorkspace + deleteWorkspace', () => {
  it('renames a workspace as an owner', async () => {
    const { orgId } = await seedOrg();
    const ws = await createWorkspace(repo, { orgId, actorUserId: OWNER, name: 'Old WS' });
    const renamed = await updateWorkspace(repo, {
      orgId,
      actorUserId: OWNER,
      workspaceId: ws.id,
      name: 'New WS',
    });
    expect(renamed.name).toBe('New WS');
  });

  it('deletes a workspace as an owner', async () => {
    const { orgId } = await seedOrg();
    const ws = await createWorkspace(repo, { orgId, actorUserId: OWNER, name: 'Doomed' });
    await deleteWorkspace(repo, { orgId, actorUserId: OWNER, workspaceId: ws.id });
    expect(await listWorkspaces(repo, orgId, OWNER)).toHaveLength(0);
  });

  it('forbids a plain member from renaming or deleting', async () => {
    const { orgId } = await seedOrg();
    const ws = await createWorkspace(repo, { orgId, actorUserId: OWNER, name: 'WS' });
    const { token } = await inviteMember(repo, {
      orgId,
      actorUserId: OWNER,
      email: 'm@x.com',
      role: 'member',
    });
    await acceptInvite(repo, { token, userId: 'plain', userEmail: 'm@x.com' });
    await expectCode(
      updateWorkspace(repo, { orgId, actorUserId: 'plain', workspaceId: ws.id, name: 'x' }),
      'forbidden',
    );
    await expectCode(
      deleteWorkspace(repo, { orgId, actorUserId: 'plain', workspaceId: ws.id }),
      'forbidden',
    );
  });

  it('404s for an unknown or cross-org workspace', async () => {
    const { orgId } = await seedOrg('Org A');
    const other = await createOrganization(repo, { name: 'Org B', ownerUserId: OWNER });
    const otherWs = await createWorkspace(repo, {
      orgId: other.organization.id,
      actorUserId: OWNER,
      name: 'B WS',
    });
    await expectCode(
      updateWorkspace(repo, { orgId, actorUserId: OWNER, workspaceId: otherWs.id, name: 'x' }),
      'not_found',
    );
    await expectCode(
      deleteWorkspace(repo, { orgId, actorUserId: OWNER, workspaceId: 'nope' }),
      'not_found',
    );
  });
});
