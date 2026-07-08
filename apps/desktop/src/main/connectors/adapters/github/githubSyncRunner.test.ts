import { describe, expect, it, vi } from 'vitest';
import { createGitHubSyncRunner } from './githubSyncRunner';
import { REPO, ISSUE, NOTIF } from './_fixtures';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
const upsertOk = async () => ({ created: 0, updated: 0, unchanged: 0, conflicts: 0 });

function fetchAllStub() {
  return vi.fn(async (url: string) => {
    if (url.includes('/user/repos')) return jsonResponse([REPO]);
    if (url.includes('/issues')) return jsonResponse([ISSUE]);
    if (url.includes('/notifications')) return jsonResponse([NOTIF]);
    return jsonResponse([]);
  });
}

describe('githubSyncRunner', () => {
  it('ignores non-github connectors (hadAdapter=false)', async () => {
    const run = createGitHubSyncRunner({
      getToken: vi.fn(), getLastSyncAt: () => null, upsert: vi.fn(upsertOk), fetchImpl: vi.fn(),
    });
    const res = await run('slack', 'acct-1');
    expect(res).toEqual({ ok: true, total: 0, hadAdapter: false, error: null });
  });

  it('fails cleanly when there is no valid token', async () => {
    const upsert = vi.fn(upsertOk);
    const run = createGitHubSyncRunner({
      getToken: async () => null, getLastSyncAt: () => null, upsert, fetchImpl: vi.fn(),
    });
    const res = await run('github', 'acct-1');
    expect(res.ok).toBe(false);
    expect(res.hadAdapter).toBe(true);
    expect(res.error).toMatch(/token/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('fetches, normalizes, and upserts on the happy path; reports the item count', async () => {
    const upsert = vi.fn(upsertOk);
    const run = createGitHubSyncRunner({
      getToken: async () => 'tok', getLastSyncAt: () => null, upsert, fetchImpl: fetchAllStub(),
      now: () => '2026-02-10T00:00:00Z',
    });
    const res = await run('github', 'acct-1');
    expect(res.ok).toBe(true);
    expect(res.hadAdapter).toBe(true);
    expect(res.total).toBe(3); // repo + issue + notification
    expect(upsert).toHaveBeenCalledOnce();
    const entities = upsert.mock.calls[0][0];
    expect(entities.map((e: { kind: string }) => e.kind).sort()).toEqual(['notification', 'project', 'task']);
  });

  it('passes lastSyncAt through for incremental sync', async () => {
    const fetchImpl = fetchAllStub();
    const run = createGitHubSyncRunner({
      getToken: async () => 'tok', getLastSyncAt: () => '2026-02-01T00:00:00Z', upsert: vi.fn(upsertOk), fetchImpl,
    });
    await run('github', 'acct-1');
    const issuesCall = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/issues'));
    expect(String(issuesCall?.[0])).toContain('since=2026-02-01');
  });

  it('does not upsert when nothing is returned', async () => {
    const upsert = vi.fn(upsertOk);
    const emptyFetch = vi.fn(async () => jsonResponse([]));
    const run = createGitHubSyncRunner({
      getToken: async () => 'tok', getLastSyncAt: () => null, upsert, fetchImpl: emptyFetch,
    });
    const res = await run('github', 'acct-1');
    expect(res.total).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('captures fetch errors as a failed result (never throws)', async () => {
    const run = createGitHubSyncRunner({
      getToken: async () => 'tok', getLastSyncAt: () => null, upsert: vi.fn(upsertOk),
      fetchImpl: vi.fn(async () => jsonResponse(null, 404)),
    });
    const res = await run('github', 'acct-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/404|failed/i);
  });
});
