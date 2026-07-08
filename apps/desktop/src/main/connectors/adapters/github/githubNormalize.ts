/**
 * GitHub → UnifiedEntity normalizer (pure). Turns raw GitHub REST responses into
 * `UnifiedEntity[]` for the existing unified store — the ONLY GitHub-specific
 * mapping. Everything downstream (dedup, memory projection, knowledge graph,
 * semantic index) is the shared runtime, untouched. Pure/side-effect-free.
 *
 * Identity: id = makeUnifiedId(connectorId, accountId, kind, sourceId) —
 * deterministic + account-scoped, so re-sync maps to the same entity (dedup +
 * incremental for free). GitHub data maps onto UnifiedEntity's first-class
 * semantic fields (body/status/author/timestamp/labels/containerId), not metadata
 * (which is reserved for flat provider scalars).
 *
 * repository → 'project';  issue/PR → 'task' (containerId → repo);  notification → 'notification'
 */
import type { UnifiedEntity, UnifiedMetadata } from '@neuropause/shared';
import { makeUnifiedId } from '../../../unified/ids';
import type { GitHubIssue, GitHubNotification, GitHubRepo } from './githubTypes';

const CONNECTOR_ID = 'github';

function labelNames(labels: GitHubIssue['labels']): string[] {
  return labels.map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean);
}

export function normalizeRepo(repo: GitHubRepo, accountId: string, syncedAt: string): UnifiedEntity {
  const sourceId = `repo-${repo.id}`;
  const metadata: UnifiedMetadata = {
    provider: 'github', type: 'repository', name: repo.name, private: repo.private, fork: repo.fork,
    archived: repo.archived, language: repo.language, stars: repo.stargazers_count,
    openIssues: repo.open_issues_count, pushedAt: repo.pushed_at,
  };
  return {
    id: makeUnifiedId(CONNECTOR_ID, accountId, 'project', sourceId), kind: 'project',
    connectorId: CONNECTOR_ID, accountId, sourceId, createdAt: repo.created_at, updatedAt: repo.updated_at,
    syncState: 'active', syncedAt, metadata, title: repo.full_name, url: repo.html_url,
    parentId: null, containerId: null, body: repo.description,
    status: repo.archived ? 'archived' : 'active', author: null, timestamp: repo.pushed_at,
    endTimestamp: null, labels: repo.language ? [repo.language] : [],
  };
}

export function normalizeIssue(
  issue: GitHubIssue, repoFullName: string, accountId: string, syncedAt: string, repoEntityId: string | null,
): UnifiedEntity {
  const isPr = Boolean(issue.pull_request);
  const sourceId = `issue-${issue.id}`;
  const metadata: UnifiedMetadata = {
    provider: 'github', type: isPr ? 'pull_request' : 'issue', repo: repoFullName,
    number: issue.number, comments: issue.comments, closedAt: issue.closed_at,
  };
  return {
    id: makeUnifiedId(CONNECTOR_ID, accountId, 'task', sourceId), kind: 'task',
    connectorId: CONNECTOR_ID, accountId, sourceId, createdAt: issue.created_at, updatedAt: issue.updated_at,
    syncState: 'active', syncedAt, metadata, title: `${repoFullName}#${issue.number}: ${issue.title}`,
    url: issue.html_url, parentId: repoEntityId, containerId: repoEntityId, body: issue.body ?? null,
    status: issue.state, author: issue.user?.login ?? null, timestamp: issue.created_at,
    endTimestamp: null, labels: labelNames(issue.labels),
  };
}

export function normalizeNotification(n: GitHubNotification, accountId: string, syncedAt: string): UnifiedEntity {
  const sourceId = `notification-${n.id}`;
  const metadata: UnifiedMetadata = {
    provider: 'github', type: 'notification', reason: n.reason, unread: n.unread,
    subjectType: n.subject.type, repo: n.repository.full_name,
  };
  return {
    id: makeUnifiedId(CONNECTOR_ID, accountId, 'notification', sourceId), kind: 'notification',
    connectorId: CONNECTOR_ID, accountId, sourceId, createdAt: n.updated_at, updatedAt: n.updated_at,
    syncState: 'active', syncedAt, metadata, title: n.subject.title, url: n.subject.url,
    parentId: null, containerId: null, body: null, status: n.unread ? 'unread' : 'read',
    author: null, timestamp: n.updated_at, endTimestamp: null, labels: [n.reason],
  };
}

export interface GitHubSyncPayload {
  repos: GitHubRepo[];
  issuesByRepo: Record<string, GitHubIssue[]>;
  notifications: GitHubNotification[];
}

export function normalizeGitHub(payload: GitHubSyncPayload, accountId: string, syncedAt: string): UnifiedEntity[] {
  const out: UnifiedEntity[] = [];
  const seen = new Set<string>();
  const repoEntityIdByName = new Map<string, string>();
  const push = (e: UnifiedEntity): void => { if (seen.has(e.id)) return; seen.add(e.id); out.push(e); };

  for (const repo of payload.repos) {
    const e = normalizeRepo(repo, accountId, syncedAt);
    repoEntityIdByName.set(repo.full_name, e.id);
    push(e);
  }
  for (const [repoName, issues] of Object.entries(payload.issuesByRepo)) {
    const repoEntityId = repoEntityIdByName.get(repoName) ?? null;
    for (const issue of issues) push(normalizeIssue(issue, repoName, accountId, syncedAt, repoEntityId));
  }
  for (const n of payload.notifications) push(normalizeNotification(n, accountId, syncedAt));
  return out;
}
