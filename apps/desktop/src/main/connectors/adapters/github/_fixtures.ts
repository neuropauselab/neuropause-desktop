import type { GitHubIssue, GitHubNotification, GitHubRepo } from './githubTypes';

export const REPO: GitHubRepo = {
  id: 620100011, full_name: 'octo/webapp', name: 'webapp', description: 'The web app', html_url: 'https://github.com/octo/webapp',
  private: false, fork: false, archived: false, language: 'TypeScript', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z',
  pushed_at: '2026-02-01T12:00:00Z', stargazers_count: 42, open_issues_count: 3,
};
export const ISSUE: GitHubIssue = {
  id: 900001, number: 482, title: 'Token rotation', body: 'Rotate on refresh', state: 'open', html_url: 'https://github.com/octo/webapp/issues/482',
  created_at: '2026-02-02T00:00:00Z', updated_at: '2026-02-03T00:00:00Z', closed_at: null, user: { login: 'octo', id: 1 },
  labels: [{ name: 'security' }, 'high'], comments: 2,
};
export const PR: GitHubIssue = {
  id: 900002, number: 483, title: 'Add refresh flow', body: null, state: 'open', html_url: 'https://github.com/octo/webapp/pull/483',
  created_at: '2026-02-04T00:00:00Z', updated_at: '2026-02-04T00:00:00Z', closed_at: null, user: { login: 'dev', id: 2 },
  pull_request: { url: 'https://api.github.com/repos/octo/webapp/pulls/483' }, labels: [], comments: 0,
};
export const NOTIF: GitHubNotification = {
  id: 'n-77', reason: 'mention', unread: true, updated_at: '2026-02-05T00:00:00Z',
  subject: { title: 'You were mentioned in #482', url: 'https://api.github.com/repos/octo/webapp/issues/482', type: 'Issue' },
  repository: { full_name: 'octo/webapp', html_url: 'https://github.com/octo/webapp' },
};
