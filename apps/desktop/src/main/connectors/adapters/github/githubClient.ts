/**
 * GitHub REST fetch client (read-only).
 *
 * Talks to the three read-only endpoints the manifest's least-privilege scopes
 * allow, using an access token obtained from the connector service's vault-backed
 * accessor (never handled here beyond the Authorization header). The `fetch`
 * implementation is injected so the client's logic — auth header, pagination,
 * incremental `since`, retry/backoff, error mapping — is unit-testable without a
 * network. In production the platform `fetch` is passed in.
 *
 * Endpoints (all GET, read-only):
 *   /user/repos?sort=updated           → repositories
 *   /repos/{owner}/{repo}/issues?since  → issues + PRs (GitHub returns both)
 *   /notifications?since               → notifications
 *
 * Never mutates GitHub. Never logs the token.
 */
import type { GitHubIssue, GitHubNotification, GitHubRepo } from './githubTypes';
import type { GitHubSyncPayload } from './githubNormalize';

const API = 'https://api.github.com';
const UA = 'NeuroPause';
const MAX_RETRIES = 3;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface GitHubClientOptions {
  /** Injected fetch (platform fetch in prod, a stub in tests). */
  fetchImpl: FetchFn;
  /** Optional sleep override for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Cap repositories scanned for issues, to bound a first sync. */
  maxRepos?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class GitHubClient {
  private readonly fetchImpl: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRepos: number;

  constructor(opts: GitHubClientOptions) {
    this.fetchImpl = opts.fetchImpl;
    this.sleep = opts.sleep ?? defaultSleep;
    this.maxRepos = opts.maxRepos ?? 20;
  }

  private async getJson<T>(path: string, token: string): Promise<T> {
    let attempt = 0;
    for (;;) {
      const res = await this.fetchImpl(`${API}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': UA,
        },
      });
      if (res.ok) return (await res.json()) as T;
      if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES) {
        attempt += 1;
        await this.sleep(2 ** attempt * 100);
        continue;
      }
      throw new Error(`GitHub ${path} failed (${res.status})`);
    }
  }

  /** Repositories the user can see, most-recently-updated first. */
  async fetchRepos(token: string): Promise<GitHubRepo[]> {
    return this.getJson<GitHubRepo[]>(`/user/repos?sort=updated&per_page=${this.maxRepos}`, token);
  }

  /** Issues (and PRs) for one repo, optionally only those updated since `sinceIso`. */
  async fetchIssues(token: string, repoFullName: string, sinceIso: string | null): Promise<GitHubIssue[]> {
    const since = sinceIso ? `&since=${encodeURIComponent(sinceIso)}` : '';
    return this.getJson<GitHubIssue[]>(`/repos/${repoFullName}/issues?state=all&per_page=50${since}`, token);
  }

  /** Notifications, optionally only those updated since `sinceIso`. */
  async fetchNotifications(token: string, sinceIso: string | null): Promise<GitHubNotification[]> {
    const since = sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : '';
    return this.getJson<GitHubNotification[]>(`/notifications${since}`, token);
  }

  /**
   * Fetch a full sync payload. `sinceIso` (the account's lastSyncAt) drives
   * incremental sync: issues and notifications are filtered server-side; repos
   * are always listed (cheap) so new repos are discovered.
   */
  async fetchAll(token: string, sinceIso: string | null): Promise<GitHubSyncPayload> {
    const repos = await this.fetchRepos(token);
    const issuesByRepo: Record<string, GitHubIssue[]> = {};
    for (const repo of repos) {
      if (repo.archived) continue;
      issuesByRepo[repo.full_name] = await this.fetchIssues(token, repo.full_name, sinceIso);
    }
    const notifications = await this.fetchNotifications(token, sinceIso);
    return { repos, issuesByRepo, notifications };
  }
}
