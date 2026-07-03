import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CloudOrgRole, SyncChange } from '@neuropause/shared';
import { createMemorySyncRepository } from './memoryRepository';
import type { SyncRepository } from './types';
import { createSyncRouter } from './router';
import { errorHandler } from '../middleware/error';

// Loose JSON typing for test response bodies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const roleByUser: Record<string, CloudOrgRole> = { owner: 'owner', member: 'member' };
const getMemberRole = async (_orgId: string, userId: string): Promise<CloudOrgRole | null> =>
  roleByUser[userId] ?? null;

function change(over: Partial<SyncChange> = {}): SyncChange {
  return {
    entityType: 'org_prefs',
    entityId: 'prefs',
    orgId: 'org-1',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deleted: false,
    data: { theme: 'dark' },
    ...over,
  };
}

describe('sync router', () => {
  let repo: SyncRepository;
  let server: Server;
  let base: string;

  beforeAll(() => {
    repo = createMemorySyncRepository();
    const app = express();
    app.use((req, _res, next) => {
      req.userId = req.header('x-test-user') || undefined;
      next();
    });
    app.use(express.json());
    app.use('/sync', createSyncRouter({ repo, getMemberRole }));
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
  });

  async function req(
    method: string,
    path: string,
    user?: string,
    body?: unknown,
  ): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (user) headers['x-test-user'] = user;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  it('push applies a change for a member and returns a cursor', async () => {
    const r = await req('POST', '/sync/org-push/push', 'owner', {
      deviceId: 'devA',
      changes: [change({ orgId: 'org-push' })],
    });
    expect(r.status).toBe(200);
    expect(r.json.results[0].status).toBe('applied');
    expect(r.json.cursor).toBeGreaterThan(0);
  });

  it('push is forbidden for a non-member', async () => {
    const r = await req('POST', '/sync/org-x/push', 'stranger', {
      deviceId: 'devA',
      changes: [change({ orgId: 'org-x' })],
    });
    expect(r.status).toBe(403);
  });

  it('push rejects a malformed body', async () => {
    const r = await req('POST', '/sync/org-x/push', 'owner', { deviceId: 'devA' });
    expect(r.status).toBe(400);
  });

  it('pull returns changes since a cursor for a member', async () => {
    await req('POST', '/sync/org-pull/push', 'owner', {
      deviceId: 'devA',
      changes: [change({ orgId: 'org-pull' })],
    });
    const r = await req('GET', '/sync/org-pull/pull?cursor=0&deviceId=devB', 'member');
    expect(r.status).toBe(200);
    expect(r.json.changes).toHaveLength(1);
    expect(r.json.changes[0].data).toEqual({ theme: 'dark' });
  });

  it('pull excludes the caller device to avoid echo', async () => {
    await req('POST', '/sync/org-echo/push', 'owner', {
      deviceId: 'devA',
      changes: [change({ orgId: 'org-echo' })],
    });
    const r = await req('GET', '/sync/org-echo/pull?cursor=0&deviceId=devA', 'owner');
    expect(r.status).toBe(200);
    expect(r.json.changes).toHaveLength(0);
  });

  it('pull filters by entity type', async () => {
    await req('POST', '/sync/org-filter/push', 'owner', {
      deviceId: 'devA',
      changes: [
        change({ orgId: 'org-filter', entityId: 'prefs' }),
        change({ orgId: 'org-filter', entityType: 'workspace_settings', entityId: 'ws-1' }),
      ],
    });
    const r = await req(
      'GET',
      '/sync/org-filter/pull?cursor=0&deviceId=devB&entityTypes=workspace_settings',
      'member',
    );
    expect(r.status).toBe(200);
    expect(r.json.changes).toHaveLength(1);
    expect(r.json.changes[0].entityType).toBe('workspace_settings');
  });

  it('pull is forbidden for a non-member', async () => {
    const r = await req('GET', '/sync/org-x/pull?cursor=0', 'stranger');
    expect(r.status).toBe(403);
  });
});
