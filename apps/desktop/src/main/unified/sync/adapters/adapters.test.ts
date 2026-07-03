import { describe, it, expect } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { mapRepo, mapIssue, mapNotification, isActiveRepo, mapRepoIssue, mapPull, mapRelease, mapCiRun, advanceDeep } from './github';
import { mapPage, mapDatabase } from './notion';
import { mapEvent } from './googleCalendar';
import { mapChannel, mapMessage } from './slack';

const ctx = (connectorId: string): SyncContext =>
  ({ connectorId, accountId: 'a1', http: undefined as never, cursor: null, now: '2026-06-01T00:00:00.000Z' });

describe('GitHub mapping', () => {
  it('maps a repo to a project', () => {
    const e = mapRepo(ctx('github'), {
      id: 123, full_name: 'acme/web', html_url: 'https://github.com/acme/web', description: 'the web app',
      created_at: '2025-01-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z', archived: false, private: true,
      stargazers_count: 5, forks_count: 2, open_issues_count: 3, language: 'TypeScript', default_branch: 'main', owner: { login: 'acme' },
    } as never);
    expect(e.id).toBe('github:a1:project:123');
    expect(e.kind).toBe('project');
    expect(e.title).toBe('acme/web');
    expect(e.status).toBe('active');
    expect(e.labels).toEqual(['TypeScript']);
    expect(e.metadata.private).toBe(true);
    expect(e.metadata.stars).toBe(5);
  });

  it('maps an issue and detects pull requests', () => {
    const e = mapIssue(ctx('github'), {
      id: 9, number: 42, title: 'Fix bug', html_url: 'https://github.com/acme/web/issues/42', body: 'broken',
      state: 'open', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z',
      user: { login: 'dev' }, assignee: null, labels: [{ name: 'bug' }, 'urgent'], comments: 1,
      pull_request: { url: 'x' }, repository_url: 'https://api.github.com/repos/acme/web',
    } as never);
    expect(e.kind).toBe('task');
    expect(e.status).toBe('open');
    expect(e.labels).toEqual(['bug', 'urgent']);
    expect(e.metadata.isPullRequest).toBe(true);
    expect(e.metadata.repository).toBe('acme/web');
  });

  it('maps a notification', () => {
    const e = mapNotification(ctx('github'), {
      id: 'n1', reason: 'mention', updated_at: '2026-03-01T00:00:00Z', unread: true,
      subject: { title: 'PR review', url: null, type: 'PullRequest' }, repository: { full_name: 'acme/web' },
    } as never);
    expect(e.kind).toBe('notification');
    expect(e.title).toBe('PR review');
    expect(e.status).toBe('unread');
    expect(e.metadata.type).toBe('PullRequest');
  });

  it('links an issue to its repository and captures rich repo metadata', () => {
    // The /issues payload embeds the repository object → containerId targets the repo UID.
    const issue = mapIssue(ctx('github'), {
      id: 9, number: 42, title: 'Fix bug', html_url: 'https://github.com/acme/web/issues/42', body: 'broken',
      state: 'open', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z',
      user: { login: 'dev' }, assignee: null, labels: [], comments: 0,
      repository_url: 'https://api.github.com/repos/acme/web', repository: { id: 123, full_name: 'acme/web' },
    } as never);
    expect(issue.containerId).toBe('github:a1:project:123');

    // Repo metadata: topics fold into labels; visibility, license and topics land in metadata.
    const repo = mapRepo(ctx('github'), {
      id: 123, full_name: 'acme/web', html_url: 'https://github.com/acme/web', description: 'the web app',
      created_at: '2025-01-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z', pushed_at: '2026-05-02T00:00:00Z',
      archived: false, private: false, visibility: 'public', stargazers_count: 5, forks_count: 2,
      open_issues_count: 3, language: 'TypeScript', default_branch: 'main', topics: ['web', 'react'],
      homepage: 'https://acme.dev', license: { spdx_id: 'MIT' }, owner: { login: 'acme', id: 1, type: 'Organization' },
    } as never);
    expect(repo.labels).toEqual(['web', 'react', 'TypeScript']);
    expect(repo.metadata.visibility).toBe('public');
    expect(repo.metadata.license).toBe('MIT');
  });
});

describe('GitHub deep sync (Increment 2)', () => {
  const now = '2026-06-01T00:00:00.000Z'; // matches ctx()
  const repo = { owner: 'acme', name: 'web', id: 123 };

  it('treats a recently-pushed, non-archived repo as active', () => {
    expect(
      isActiveRepo(
        { full_name: 'acme/web', archived: false, pushed_at: '2026-05-20T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', open_issues_count: 0 } as never,
        now,
      ),
    ).toBe(true);
  });

  it('treats an open-issues repo as active even with no recent push', () => {
    expect(
      isActiveRepo(
        { full_name: 'acme/web', archived: false, pushed_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', open_issues_count: 4 } as never,
        now,
      ),
    ).toBe(true);
  });

  it('treats a stale, issue-free repo as inactive — and never an archived one', () => {
    expect(
      isActiveRepo(
        { full_name: 'acme/web', archived: false, pushed_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', open_issues_count: 0 } as never,
        now,
      ),
    ).toBe(false);
    expect(
      isActiveRepo(
        { full_name: 'acme/web', archived: true, pushed_at: '2026-05-30T00:00:00Z', updated_at: '2026-05-30T00:00:00Z', open_issues_count: 9 } as never,
        now,
      ),
    ).toBe(false);
  });

  it('maps an open issue to a repo-linked task', () => {
    const e = mapRepoIssue(ctx('github'), repo, {
      id: 10, number: 7, title: 'Crash on launch', html_url: 'https://github.com/acme/web/issues/7',
      body: 'stack trace', state: 'open', created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-10T00:00:00Z',
      user: { login: 'dev' }, assignee: { login: 'lead' }, labels: [{ name: 'bug' }], comments: 2,
    } as never);
    expect(e.kind).toBe('task');
    expect(e.status).toBe('open');
    expect(e.containerId).toBe('github:a1:project:123');
    expect(e.metadata.isPullRequest).toBe(false);
    expect(e.metadata.repository).toBe('acme/web');
    expect(e.id).toBe('github:a1:task:10');
  });

  it('maps an open PR to a task with review signal, drafts flagged', () => {
    const e = mapPull(ctx('github'), repo, {
      id: 55, number: 12, title: 'Add caching', html_url: 'https://github.com/acme/web/pull/12',
      body: 'perf', state: 'open', draft: true, created_at: '2026-05-02T00:00:00Z', updated_at: '2026-05-11T00:00:00Z',
      user: { login: 'dev' }, labels: ['perf'], requested_reviewers: [{ login: 'lead' }, { login: 'qa' }],
    } as never);
    expect(e.kind).toBe('task');
    expect(e.status).toBe('draft');
    expect(e.containerId).toBe('github:a1:project:123');
    expect(e.metadata.isPullRequest).toBe(true);
    expect(e.metadata.reviewers).toBe(2);
    expect(e.id).toBe('github:a1:task:55');
  });

  it('maps a release to a repo-linked activity', () => {
    const e = mapRelease(ctx('github'), repo, {
      id: 88, tag_name: 'v1.2.0', name: 'Spring release', html_url: 'https://github.com/acme/web/releases/tag/v1.2.0',
      body: 'notes', draft: false, prerelease: false, created_at: '2026-04-01T00:00:00Z', published_at: '2026-04-02T00:00:00Z',
      author: { login: 'lead' },
    } as never);
    expect(e.kind).toBe('activity');
    expect(e.status).toBe('released');
    expect(e.containerId).toBe('github:a1:project:123');
    expect(e.timestamp).toBe('2026-04-02T00:00:00Z');
    expect(e.metadata.tag).toBe('v1.2.0');
    expect(e.metadata.activityKind).toBe('release');
    expect(e.labels).toEqual(['v1.2.0']);
  });

  it('maps a CI workflow run to a repo-linked activity with conclusion', () => {
    const e = mapCiRun(ctx('github'), repo, {
      id: 9001, name: 'CI', head_branch: 'main', status: 'completed', conclusion: 'failure',
      run_number: 42, event: 'push', html_url: 'https://github.com/acme/web/actions/runs/9001',
      created_at: '2026-05-28T13:21:00Z', updated_at: '2026-05-28T13:25:00Z', run_started_at: '2026-05-28T13:21:00Z',
    } as never);
    expect(e.kind).toBe('activity');
    expect(e.id).toBe('github:a1:activity:run-9001'); // prefixed id never collides with a release
    expect(e.status).toBe('failure');
    expect(e.containerId).toBe('github:a1:project:123');
    expect(e.metadata.activityKind).toBe('ci_run');
    expect(e.metadata.conclusion).toBe('failure');
    expect(e.metadata.branch).toBe('main');
    expect(e.title).toBe('CI failure on main');
  });

  it('advanceDeep walks issues → prs → releases → next repo → done', () => {
    const active = [repo, { owner: 'acme', name: 'api', id: 200 }];
    const parse = (s: string | null) => (s ? JSON.parse(s) : null);

    // more pages of the same resource → same repo/res, next page
    expect(parse(advanceDeep(active, 0, 'issues', 1, true))).toMatchObject({ phase: 'deep', i: 0, res: 'issues', resPage: 2 });
    // issues exhausted → prs
    expect(parse(advanceDeep(active, 0, 'issues', 1, false))).toMatchObject({ i: 0, res: 'prs', resPage: 1 });
    // prs exhausted → releases
    expect(parse(advanceDeep(active, 0, 'prs', 1, false))).toMatchObject({ i: 0, res: 'releases', resPage: 1 });
    // releases exhausted → ci (same repo)
    expect(parse(advanceDeep(active, 0, 'releases', 1, false))).toMatchObject({ i: 0, res: 'ci', resPage: 1 });
    // ci exhausted, more repos → next repo, back to issues
    expect(parse(advanceDeep(active, 0, 'ci', 1, false))).toMatchObject({ i: 1, res: 'issues', resPage: 1 });
    // ci exhausted on the last repo → finished
    expect(advanceDeep(active, 1, 'ci', 1, false)).toBeNull();
  });

  it('advanceDeep caps runaway pagination, advancing to the next resource', () => {
    // at the page cap, even with more pages reported, it moves on instead of looping
    const parsed = JSON.parse(advanceDeep([repo], 0, 'issues', 10, true) as string);
    expect(parsed).toMatchObject({ res: 'prs', resPage: 1 });
  });
});

describe('Notion mapping', () => {
  it('maps a page to a document with a parent-database link', () => {
    const e = mapPage(ctx('notion'), {
      id: 'p1', url: 'https://notion.so/p1', created_time: '2026-01-01T00:00:00Z', last_edited_time: '2026-04-01T00:00:00Z',
      archived: false, parent: { type: 'database_id', database_id: 'db1' },
      properties: { Name: { type: 'title', title: [{ plain_text: 'Roadmap' }] } }, last_edited_by: { id: 'u1' },
    } as never);
    expect(e.kind).toBe('document');
    expect(e.title).toBe('Roadmap');
    expect(e.containerId).toBe('notion:a1:project:db1');
  });

  it('maps a database to a project', () => {
    const e = mapDatabase(ctx('notion'), {
      id: 'db1', url: 'https://notion.so/db1', created_time: '2026-01-01T00:00:00Z', last_edited_time: '2026-04-01T00:00:00Z',
      archived: false, title: [{ plain_text: 'Tasks DB' }],
    } as never);
    expect(e.kind).toBe('project');
    expect(e.title).toBe('Tasks DB');
  });
});

describe('Google Calendar mapping', () => {
  it('maps an event to a calendar_event with start/end + attendees', () => {
    const e = mapEvent(ctx('google-calendar'), {
      id: 'ev1', status: 'confirmed', summary: 'Standup', description: 'daily', htmlLink: 'https://cal/ev1',
      created: '2026-01-01T00:00:00Z', updated: '2026-05-01T00:00:00Z',
      start: { dateTime: '2026-06-02T09:00:00Z' }, end: { dateTime: '2026-06-02T09:15:00Z' },
      organizer: { email: 'boss@acme.com' }, attendees: [{}, {}], location: 'Zoom',
    } as never);
    expect(e.kind).toBe('calendar_event');
    expect(e.title).toBe('Standup');
    expect(e.timestamp).toBe('2026-06-02T09:00:00Z');
    expect(e.endTimestamp).toBe('2026-06-02T09:15:00Z');
    expect(e.metadata.attendees).toBe(2);
  });
});

describe('Slack mapping', () => {
  it('maps a channel to a conversation', () => {
    const e = mapChannel(ctx('slack'), {
      id: 'C1', name: 'general', created: 1609459200, is_archived: false, is_private: false, is_member: true,
      num_members: 10, topic: { value: 'chat' }, purpose: { value: 'team' },
    } as never);
    expect(e.kind).toBe('conversation');
    expect(e.title).toBe('#general');
    expect(e.metadata.numMembers).toBe(10);
  });

  it('maps a message linked to its channel', () => {
    const e = mapMessage(ctx('slack'), 'C1', {
      ts: '1609459201.000200', text: 'hello team\nsecond line', user: 'U1', reactions: [{}],
    } as never);
    expect(e.kind).toBe('message');
    expect(e.title).toBe('hello team');
    expect(e.parentId).toBe('slack:a1:conversation:C1');
    expect(e.sourceId).toBe('C1:1609459201.000200');
    expect(e.author).toBe('U1');
  });
});
