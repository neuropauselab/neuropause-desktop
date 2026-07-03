/**
 * Typed client for the backend /organizations API. Like catalogClient, this runs
 * only in the main process — the renderer reaches it through IPC, never the
 * backend directly. Every organization call is authenticated: the access token
 * is attached from the auth service (refreshing transparently).
 */
import type {
  CloudInviteResult,
  CloudMembership,
  CloudOrgCreateResult,
  CloudOrgRole,
  CloudOrganization,
  CloudOrganizationSummary,
  CloudWorkspace,
} from '@neuropause/shared';
import { config } from '../config';
import { authService } from '../auth/authService';

export class OrgApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'OrgApiError';
    this.status = status;
    this.code = code;
  }
}

interface OrgRequestInit {
  method?: string;
  body?: unknown;
}

async function orgRequest<T>(path: string, init: OrgRequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const token = await authService.getValidAccessToken();
  if (!token) throw new OrgApiError(401, 'not_authenticated', 'Sign in to manage organizations.');
  headers.Authorization = `Bearer ${token}`;

  const url = `${config.backendUrl}/organizations${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    throw new OrgApiError(0, 'network_error', (err as Error).message || 'Network request failed');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;

  if (!res.ok) {
    const body = (json ?? {}) as { error?: { code?: string; message?: string } };
    throw new OrgApiError(
      res.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? `Request failed with status ${res.status}`,
    );
  }
  return json as T;
}

export const orgClient = {
  /** Organizations the current user belongs to. */
  list: () =>
    orgRequest<{ organizations: CloudOrganizationSummary[] }>('').then((r) => r.organizations),

  create: (body: { name: string; slug?: string }) =>
    orgRequest<CloudOrgCreateResult>('', { method: 'POST', body }),

  get: (orgId: string) =>
    orgRequest<{ organization: CloudOrganization }>(`/${orgId}`).then((r) => r.organization),

  update: (orgId: string, name: string) =>
    orgRequest<{ organization: CloudOrganization }>(`/${orgId}`, {
      method: 'PATCH',
      body: { name },
    }).then((r) => r.organization),

  members: (orgId: string) =>
    orgRequest<{ members: CloudMembership[] }>(`/${orgId}/members`).then((r) => r.members),

  invite: (orgId: string, body: { email: string; role: CloudOrgRole }) =>
    orgRequest<CloudInviteResult>(`/${orgId}/invitations`, { method: 'POST', body }),

  acceptInvite: (token: string) =>
    orgRequest<{ membership: CloudMembership }>('/accept-invite', {
      method: 'POST',
      body: { token },
    }).then((r) => r.membership),

  changeRole: (orgId: string, membershipId: string, role: CloudOrgRole) =>
    orgRequest<{ membership: CloudMembership }>(`/${orgId}/members/${membershipId}`, {
      method: 'PATCH',
      body: { role },
    }).then((r) => r.membership),

  removeMember: (orgId: string, membershipId: string) =>
    orgRequest<void>(`/${orgId}/members/${membershipId}`, { method: 'DELETE' }),

  workspaces: (orgId: string) =>
    orgRequest<{ workspaces: CloudWorkspace[] }>(`/${orgId}/workspaces`).then((r) => r.workspaces),

  createWorkspace: (orgId: string, name: string) =>
    orgRequest<{ workspace: CloudWorkspace }>(`/${orgId}/workspaces`, {
      method: 'POST',
      body: { name },
    }).then((r) => r.workspace),

  updateWorkspace: (orgId: string, workspaceId: string, name: string) =>
    orgRequest<{ workspace: CloudWorkspace }>(`/${orgId}/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: { name },
    }).then((r) => r.workspace),

  deleteWorkspace: (orgId: string, workspaceId: string) =>
    orgRequest<void>(`/${orgId}/workspaces/${workspaceId}`, { method: 'DELETE' }),
};
