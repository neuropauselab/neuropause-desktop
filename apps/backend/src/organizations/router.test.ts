import 'express-async-errors';
import { afterEach, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMemoryOrgRepository } from './memoryRepository';
import { createOrganizationsRouter } from './router';
import { errorHandler, notFoundHandler } from '../middleware/error';

/**
 * Build a test app that mounts the org router behind a stub auth middleware:
 * the caller is taken from x-test-user / x-test-email headers, standing in for
 * what `requireAuth` would populate in production.
 */
function buildApp(): Express {
  const repo = createMemoryOrgRepository();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = req.header('x-test-user') || undefined;
    req.userEmail = req.header('x-test-email') || undefined;
    next();
  });
  app.use('/organizations', createOrganizationsRouter(repo));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

let server: Server | undefined;
async function start(): Promise<string> {
  const app = buildApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  const { port } = server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}
afterEach(() => {
  server?.close();
  server = undefined;
});

interface Actor {
  user: string;
  email?: string;
}
interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic JSON response body under test
  body: any;
}

async function call(
  base: string,
  method: string,
  path: string,
  actor?: Actor,
  body?: unknown,
): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (actor) {
    headers['x-test-user'] = actor.user;
    if (actor.email) headers['x-test-email'] = actor.email;
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const owner: Actor = { user: 'user-owner', email: 'owner@acme.com' };

async function createOrg(base: string): Promise<string> {
  const res = await call(base, 'POST', '/organizations', owner, { name: 'Acme' });
  return res.body.organization.id as string;
}

describe('POST /organizations', () => {
  it('creates an org with the caller as owner', async () => {
    const base = await start();
    const res = await call(base, 'POST', '/organizations', owner, { name: 'Acme Inc' });
    expect(res.status).toBe(201);
    expect(res.body.organization.slug).toBe('acme-inc');
    expect(res.body.membership.role).toBe('owner');
  });

  it('rejects an unauthenticated caller with 401', async () => {
    const base = await start();
    const res = await call(base, 'POST', '/organizations', undefined, { name: 'X' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a missing name with a 400 validation error', async () => {
    const base = await start();
    const res = await call(base, 'POST', '/organizations', owner, {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('GET /organizations (my orgs)', () => {
  it('lists the active organizations the caller belongs to', async () => {
    const base = await start();
    await call(base, 'POST', '/organizations', owner, { name: 'Acme One' });
    await call(base, 'POST', '/organizations', owner, { name: 'Acme Two' });
    const res = await call(base, 'GET', '/organizations', owner);
    expect(res.status).toBe(200);
    const names = res.body.organizations.map((o: { name: string }) => o.name).sort();
    expect(names).toEqual(['Acme One', 'Acme Two']);
    expect(res.body.organizations[0].role).toBe('owner');
  });

  it('excludes organizations the caller is not a member of', async () => {
    const base = await start();
    await call(base, 'POST', '/organizations', owner, { name: 'Owner Org' });
    const other: Actor = { user: 'user-other', email: 'other@acme.com' };
    const res = await call(base, 'GET', '/organizations', other);
    expect(res.status).toBe(200);
    expect(res.body.organizations).toHaveLength(0);
  });
});

describe('invite → accept flow', () => {
  it('invites a member and the invitee accepts, becoming active', async () => {
    const base = await start();
    const orgId = await createOrg(base);

    const invite = await call(base, 'POST', `/organizations/${orgId}/invitations`, owner, {
      email: 'bob@acme.com',
      role: 'member',
    });
    expect(invite.status).toBe(201);
    const token: string = invite.body.token;
    expect(typeof token).toBe('string');

    const bob: Actor = { user: 'user-bob', email: 'bob@acme.com' };
    const accept = await call(base, 'POST', '/organizations/accept-invite', bob, { token });
    expect(accept.status).toBe(200);
    expect(accept.body.membership.status).toBe('active');
    expect(accept.body.membership.userId).toBe('user-bob');

    const members = await call(base, 'GET', `/organizations/${orgId}/members`, owner);
    expect(members.status).toBe(200);
    expect(members.body.members).toHaveLength(2);
  });

  it('returns 403 when a mismatched email accepts the invite', async () => {
    const base = await start();
    const orgId = await createOrg(base);
    const invite = await call(base, 'POST', `/organizations/${orgId}/invitations`, owner, {
      email: 'right@acme.com',
      role: 'member',
    });
    const wrong: Actor = { user: 'user-x', email: 'wrong@acme.com' };
    const accept = await call(base, 'POST', '/organizations/accept-invite', wrong, {
      token: invite.body.token,
    });
    expect(accept.status).toBe(403);
    expect(accept.body.error.code).toBe('org_forbidden');
  });

  it('returns 400 for an unknown invite token', async () => {
    const base = await start();
    const someone: Actor = { user: 'u', email: 'u@x.com' };
    const res = await call(base, 'POST', '/organizations/accept-invite', someone, {
      token: 'nope',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('org_invalid');
  });
});

describe('member management', () => {
  it('forbids a non-manager from inviting (403)', async () => {
    const base = await start();
    const orgId = await createOrg(base);
    // invite + accept a plain member (bob)
    const invite = await call(base, 'POST', `/organizations/${orgId}/invitations`, owner, {
      email: 'bob@acme.com',
      role: 'member',
    });
    const bob: Actor = { user: 'user-bob', email: 'bob@acme.com' };
    await call(base, 'POST', '/organizations/accept-invite', bob, { token: invite.body.token });

    const res = await call(base, 'POST', `/organizations/${orgId}/invitations`, bob, {
      email: 'carol@acme.com',
      role: 'member',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('org_forbidden');
  });

  it('prevents demoting the last owner (409)', async () => {
    const base = await start();
    const orgId = await createOrg(base);
    const members = await call(base, 'GET', `/organizations/${orgId}/members`, owner);
    const ownerMembershipId = members.body.members[0].id;
    const res = await call(
      base,
      'PATCH',
      `/organizations/${orgId}/members/${ownerMembershipId}`,
      owner,
      {
        role: 'admin',
      },
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('org_conflict');
  });

  it('returns 404 changing a role for an unknown membership', async () => {
    const base = await start();
    const orgId = await createOrg(base);
    const res = await call(base, 'PATCH', `/organizations/${orgId}/members/does-not-exist`, owner, {
      role: 'admin',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('org_not_found');
  });

  it('removes a member (204)', async () => {
    const base = await start();
    const orgId = await createOrg(base);
    const invite = await call(base, 'POST', `/organizations/${orgId}/invitations`, owner, {
      email: 'bob@acme.com',
      role: 'member',
    });
    const bob: Actor = { user: 'user-bob', email: 'bob@acme.com' };
    await call(base, 'POST', '/organizations/accept-invite', bob, { token: invite.body.token });
    const members = await call(base, 'GET', `/organizations/${orgId}/members`, owner);
    const bobMembership = members.body.members.find(
      (m: { userId: string }) => m.userId === 'user-bob',
    );

    const res = await call(
      base,
      'DELETE',
      `/organizations/${orgId}/members/${bobMembership.id}`,
      owner,
    );
    expect(res.status).toBe(204);
    const after = await call(base, 'GET', `/organizations/${orgId}/members`, owner);
    expect(after.body.members).toHaveLength(1);
  });
});

describe('workspaces', () => {
  it('creates and lists a workspace', async () => {
    const base = await start();
    const orgId = await createOrg(base);
    const created = await call(base, 'POST', `/organizations/${orgId}/workspaces`, owner, {
      name: 'Research',
    });
    expect(created.status).toBe(201);
    expect(created.body.workspace.name).toBe('Research');

    const list = await call(base, 'GET', `/organizations/${orgId}/workspaces`, owner);
    expect(list.status).toBe(200);
    expect(list.body.workspaces).toHaveLength(1);
  });
});
