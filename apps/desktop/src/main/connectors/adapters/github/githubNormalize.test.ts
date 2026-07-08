import { describe, expect, it } from 'vitest';
import { normalizeGitHub, normalizeRepo, normalizeIssue, normalizeNotification } from './githubNormalize';
import { REPO, ISSUE, PR, NOTIF } from './_fixtures';

const ACCT = 'acct-1';
const NOW = '2026-02-10T00:00:00Z';

describe('githubNormalize', () => {
  it('maps a repo to a project entity with a deterministic account-scoped id', () => {
    const e = normalizeRepo(REPO, ACCT, NOW);
    expect(e.kind).toBe('project');
    expect(e.id).toBe('github:acct-1:project:repo-620100011');
    expect(e.connectorId).toBe('github');
    expect(e.accountId).toBe('acct-1');
    expect(e.title).toBe('octo/webapp');
    expect(e.url).toBe('https://github.com/octo/webapp');
    expect(e.metadata.language).toBe('TypeScript');
    expect(e.body).toBe('The web app');
    expect(e.status).toBe('active');
    expect(e.labels).toEqual(['TypeScript']);
    expect(e.syncedAt).toBe(NOW);
  });

  it('is deterministic — same input yields the same id (dedup basis)', () => {
    expect(normalizeRepo(REPO, ACCT, NOW).id).toBe(normalizeRepo(REPO, ACCT, '2099-01-01T00:00:00Z').id);
  });

  it('account-scopes ids so two accounts never alias', () => {
    expect(normalizeRepo(REPO, 'acct-1', NOW).id).not.toBe(normalizeRepo(REPO, 'acct-2', NOW).id);
  });

  it('maps an issue to a task parented to its repo, with labels', () => {
    const repoId = normalizeRepo(REPO, ACCT, NOW).id;
    const e = normalizeIssue(ISSUE, 'octo/webapp', ACCT, NOW, repoId);
    expect(e.kind).toBe('task');
    expect(e.id).toBe('github:acct-1:task:issue-900001');
    expect(e.parentId).toBe(repoId);
    expect(e.title).toBe('octo/webapp#482: Token rotation');
    expect(e.metadata.type).toBe('issue');
    expect(e.labels).toEqual(['security', 'high']);
    expect(e.status).toBe('open');
    expect(e.author).toBe('octo');
    expect(e.containerId).toBe(repoId);
    expect(e.body).toBe('Rotate on refresh');
  });

  it('distinguishes a pull request from an issue', () => {
    const e = normalizeIssue(PR, 'octo/webapp', ACCT, NOW, null);
    expect(e.metadata.type).toBe('pull_request');
    expect(e.parentId).toBeNull();
    expect(e.body).toBeNull();
  });

  it('maps a notification to a notification entity', () => {
    const e = normalizeNotification(NOTIF, ACCT, NOW);
    expect(e.kind).toBe('notification');
    expect(e.id).toBe('github:acct-1:notification:notification-n-77');
    expect(e.metadata.reason).toBe('mention');
    expect(e.title).toBe('You were mentioned in #482');
  });

  it('normalizes a full payload into a deduplicated entity list with issue→repo linkage', () => {
    const out = normalizeGitHub(
      { repos: [REPO], issuesByRepo: { 'octo/webapp': [ISSUE, PR] }, notifications: [NOTIF] },
      ACCT,
      NOW,
    );
    expect(out).toHaveLength(4);
    const repo = out.find((e) => e.kind === 'project')!;
    const issue = out.find((e) => e.sourceId === 'issue-900001')!;
    expect(issue.containerId).toBe(repo.id);
    expect(new Set(out.map((e) => e.id)).size).toBe(4);
  });

  it('guards against duplicate ids within a single batch', () => {
    const out = normalizeGitHub({ repos: [REPO, REPO], issuesByRepo: {}, notifications: [] }, ACCT, NOW);
    expect(out).toHaveLength(1);
  });
});
