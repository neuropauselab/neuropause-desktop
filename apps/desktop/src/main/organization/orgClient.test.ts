import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({ config: { backendUrl: 'http://test.local:4000' } }));
const getValidAccessToken = vi.fn<() => Promise<string | null>>();
vi.mock('../auth/authService', () => ({
  authService: { getValidAccessToken: () => getValidAccessToken() },
}));

import { OrgApiError, orgClient } from './orgClient';

interface MockRes {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}
function res(status: number, body?: unknown): MockRes {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  getValidAccessToken.mockReset();
  getValidAccessToken.mockResolvedValue('tok-123');
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const BASE = 'http://test.local:4000/organizations';
function lastCall(): [string, { method?: string; headers: Record<string, string>; body?: string }] {
  return fetchMock.mock.calls[0] as never;
}

describe('orgClient — requests', () => {
  it('list GETs /organizations with a bearer token and unwraps organizations', async () => {
    fetchMock.mockResolvedValue(
      res(200, {
        organizations: [{ membershipId: 'm1', orgId: 'o1', slug: 's', name: 'N', role: 'owner' }],
      }),
    );
    const orgs = await orgClient.list();
    expect(orgs).toHaveLength(1);
    const [url, opts] = lastCall();
    expect(url).toBe(BASE);
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer tok-123');
  });

  it('create POSTs the body', async () => {
    fetchMock.mockResolvedValue(res(201, { organization: {}, membership: {} }));
    await orgClient.create({ name: 'Acme' });
    const [url, opts] = lastCall();
    expect(url).toBe(BASE);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body!)).toEqual({ name: 'Acme' });
  });

  it('members GETs /:orgId/members and unwraps', async () => {
    fetchMock.mockResolvedValue(res(200, { members: [{ id: 'x' }] }));
    const members = await orgClient.members('o1');
    expect(members).toHaveLength(1);
    expect(lastCall()[0]).toBe(`${BASE}/o1/members`);
  });

  it('invite POSTs email + role', async () => {
    fetchMock.mockResolvedValue(res(201, { membership: {}, token: 't' }));
    const result = await orgClient.invite('o1', { email: 'a@b.com', role: 'member' });
    expect(result.token).toBe('t');
    const [url, opts] = lastCall();
    expect(url).toBe(`${BASE}/o1/invitations`);
    expect(JSON.parse(opts.body!)).toEqual({ email: 'a@b.com', role: 'member' });
  });

  it('changeRole PATCHes the role', async () => {
    fetchMock.mockResolvedValue(res(200, { membership: { role: 'admin' } }));
    await orgClient.changeRole('o1', 'm1', 'admin');
    const [url, opts] = lastCall();
    expect(url).toBe(`${BASE}/o1/members/m1`);
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body!)).toEqual({ role: 'admin' });
  });

  it('removeMember DELETEs and resolves undefined on 204', async () => {
    fetchMock.mockResolvedValue(res(204));
    await expect(orgClient.removeMember('o1', 'm1')).resolves.toBeUndefined();
    expect(lastCall()[1].method).toBe('DELETE');
  });

  it('createWorkspace POSTs a name and unwraps workspace', async () => {
    fetchMock.mockResolvedValue(res(201, { workspace: { id: 'w1', name: 'Research' } }));
    const ws = await orgClient.createWorkspace('o1', 'Research');
    expect(ws.name).toBe('Research');
    expect(lastCall()[0]).toBe(`${BASE}/o1/workspaces`);
  });
});

describe('orgClient — errors', () => {
  it('maps a backend error body to OrgApiError', async () => {
    fetchMock.mockResolvedValue(res(403, { error: { code: 'org_forbidden', message: 'nope' } }));
    await expect(orgClient.members('o1')).rejects.toMatchObject({
      name: 'OrgApiError',
      status: 403,
      code: 'org_forbidden',
    });
  });

  it('throws 401 without calling fetch when there is no token', async () => {
    getValidAccessToken.mockResolvedValue(null);
    await expect(orgClient.list()).rejects.toMatchObject({
      status: 401,
      code: 'not_authenticated',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wraps network failures', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(orgClient.list()).rejects.toBeInstanceOf(OrgApiError);
  });
});

describe('orgClient — profile', () => {
  it('get GETs /:orgId and unwraps organization', async () => {
    fetchMock.mockResolvedValue(res(200, { organization: { id: 'o1', slug: 's', name: 'N' } }));
    const org = await orgClient.get('o1');
    expect(org.name).toBe('N');
    const [url, opts] = lastCall();
    expect(url).toBe(`${BASE}/o1`);
    expect(opts.method).toBe('GET');
  });

  it('update PATCHes the name', async () => {
    fetchMock.mockResolvedValue(res(200, { organization: { id: 'o1', name: 'Renamed' } }));
    const org = await orgClient.update('o1', 'Renamed');
    expect(org.name).toBe('Renamed');
    const [url, opts] = lastCall();
    expect(url).toBe(`${BASE}/o1`);
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body!)).toEqual({ name: 'Renamed' });
  });
});

describe('orgClient — workspaces', () => {
  it('updateWorkspace PATCHes /:orgId/workspaces/:id', async () => {
    fetchMock.mockResolvedValue(res(200, { workspace: { id: 'w1', name: 'R&D' } }));
    const ws = await orgClient.updateWorkspace('o1', 'w1', 'R&D');
    expect(ws.name).toBe('R&D');
    const [url, opts] = lastCall();
    expect(url).toBe(`${BASE}/o1/workspaces/w1`);
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body!)).toEqual({ name: 'R&D' });
  });

  it('deleteWorkspace DELETEs and resolves on 204', async () => {
    fetchMock.mockResolvedValue(res(204));
    await expect(orgClient.deleteWorkspace('o1', 'w1')).resolves.toBeUndefined();
    const [url, opts] = lastCall();
    expect(url).toBe(`${BASE}/o1/workspaces/w1`);
    expect(opts.method).toBe('DELETE');
  });
});
