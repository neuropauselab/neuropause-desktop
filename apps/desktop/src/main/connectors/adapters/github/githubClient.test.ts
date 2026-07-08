import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from './githubClient';
import { REPO, ISSUE, NOTIF } from './_fixtures';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('GitHubClient', () => {
  it('sends a Bearer token and the GitHub API headers', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([REPO]));
    const c = new GitHubClient({ fetchImpl });
    await c.fetchRepos('tok-123');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/user/repos');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-123');
    expect(headers.Accept).toBe('application/vnd.github+json');
  });

  it('passes the since parameter for incremental issue sync', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([ISSUE]));
    const c = new GitHubClient({ fetchImpl });
    await c.fetchIssues('tok', 'octo/webapp', '2026-02-01T00:00:00Z');
    expect(fetchImpl.mock.calls[0][0]).toContain('since=2026-02-01');
  });

  it('omits since on a first (full) sync', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    const c = new GitHubClient({ fetchImpl });
    await c.fetchNotifications('tok', null);
    expect(fetchImpl.mock.calls[0][0]).not.toContain('since');
  });

  it('retries on a 503 then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null, 503))
      .mockResolvedValueOnce(jsonResponse([REPO]));
    const c = new GitHubClient({ fetchImpl, sleep: async () => undefined });
    const repos = await c.fetchRepos('tok');
    expect(repos).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after max retries on persistent 500', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(null, 500));
    const c = new GitHubClient({ fetchImpl, sleep: async () => undefined });
    await expect(c.fetchRepos('tok')).rejects.toThrow(/failed \(500\)/);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });

  it('does not retry a 404 (non-retryable)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(null, 404));
    const c = new GitHubClient({ fetchImpl, sleep: async () => undefined });
    await expect(c.fetchRepos('tok')).rejects.toThrow(/404/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fetchAll assembles repos, issues-by-repo, and notifications; skips archived repos', async () => {
    const archived = { ...REPO, id: 999, full_name: 'octo/old', archived: true };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/user/repos')) return jsonResponse([REPO, archived]);
      if (url.includes('/issues')) return jsonResponse([ISSUE]);
      if (url.includes('/notifications')) return jsonResponse([NOTIF]);
      return jsonResponse([]);
    });
    const c = new GitHubClient({ fetchImpl });
    const payload = await c.fetchAll('tok', null);
    expect(payload.repos).toHaveLength(2);
    expect(Object.keys(payload.issuesByRepo)).toEqual(['octo/webapp']); // archived skipped
    expect(payload.notifications).toHaveLength(1);
  });
});
