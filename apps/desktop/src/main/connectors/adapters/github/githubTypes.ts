/**
 * Minimal shapes of the GitHub REST responses the sync adapter reads. Only the
 * fields the normalizer actually uses are typed; GitHub returns much more. These
 * are read-only projections — the adapter never writes to GitHub.
 *
 * Endpoints (all read-only, per the manifest's least-privilege scopes):
 *   GET /user/repos              → GitHubRepo[]     (repo:read via `repo`)
 *   GET /repos/{o}/{r}/issues    → GitHubIssue[]    (`repo`)
 *   GET /notifications           → GitHubNotification[] (`notifications`)
 */

export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  created_at: string;
  updated_at: string;
  pushed_at: string | null;
  stargazers_count: number;
  open_issues_count: number;
}

export interface GitHubUserRef {
  login: string;
  id: number;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  user: GitHubUserRef | null;
  /** Present on PRs, absent on plain issues — lets us distinguish the two. */
  pull_request?: { url: string } | undefined;
  labels: Array<{ name: string } | string>;
  comments: number;
}

export interface GitHubNotificationSubject {
  title: string;
  url: string | null;
  type: string;
}

export interface GitHubNotification {
  id: string;
  reason: string;
  unread: boolean;
  updated_at: string;
  subject: GitHubNotificationSubject;
  repository: { full_name: string; html_url: string };
}
