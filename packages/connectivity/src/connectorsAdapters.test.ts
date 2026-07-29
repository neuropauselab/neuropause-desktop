import { describe, it, expect, afterAll } from 'vitest';
import { FakeHttpClient, type HttpResponse, type HttpRequest } from '@neuropause/integrations';
import { createPgliteDriver, type SqlDriver } from '@neuropause/persistence';
import { GitHubConnector } from './providers/github';
import { GmailConnector } from './providers/gmail';
import { CalendarConnector } from './providers/calendar';
import { SlackConnector } from './providers/slack';
import { JiraConnector } from './providers/jira';
import { NotionConnector } from './providers/notion';
import { PostgresConnector } from './providers/postgres';

const ok = (body: unknown): HttpResponse => ({ status: 200, ok: true, headers: {}, body: JSON.stringify(body) });
const router = (routes: Array<[string, unknown]>) => (req: HttpRequest): HttpResponse => {
  for (const [needle, body] of routes) if (req.url.includes(needle)) return ok(body);
  return ok([]);
};

describe('Modules 4-10 — Provider adapters (verified via simulated transport)', () => {
  it('GitHub: repos, PRs, commits, workflow runs — with correct auth headers (Connector Test)', async () => {
    const http = new FakeHttpClient(
      router([
        ['/user/repos', [{ id: 1, name: 'r', full_name: 'o/r', private: true }]],
        ['/pulls', [{ number: 7, title: 'PR', state: 'open' }]],
        ['/commits', [{ sha: 'abc', commit: { message: 'msg', author: { name: 'Ada' } } }]],
        ['/actions/runs', { workflow_runs: [{ id: 9, name: 'CI', status: 'completed', conclusion: 'success' }] }],
        ['/members', [{ id: 5, login: 'octocat' }]],
      ]),
    );
    const gh = new GitHubConnector(http, { token: 'gho_x' });
    expect((await gh.listRepos())[0].fullName).toBe('o/r');
    expect(http.lastRequest!.headers?.Authorization).toBe('Bearer gho_x');
    expect(http.lastRequest!.headers?.['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect((await gh.listPullRequests('o', 'r'))[0].number).toBe(7);
    expect((await gh.listCommits('o', 'r'))[0].author).toBe('Ada');
    expect((await gh.listWorkflowRuns('o', 'r'))[0].conclusion).toBe('success');
    expect((await gh.listOrgMembers('acme'))[0].login).toBe('octocat');
  });

  it('Gmail: messages, unread (q=is:unread), labels, drafts, attachments', async () => {
    const http = new FakeHttpClient((req) => {
      if (/messages\/m1/.test(req.url)) return ok({ payload: { parts: [{ filename: 'a.pdf', mimeType: 'application/pdf', body: { attachmentId: 'att1' } }] } });
      if (req.url.includes('/messages')) return ok({ messages: [{ id: 'm1', threadId: 't1' }] });
      if (req.url.includes('/labels')) return ok({ labels: [{ id: 'L1', name: 'INBOX', type: 'system' }] });
      if (req.url.includes('/drafts')) return ok({ drafts: [{ id: 'd1', message: { id: 'm9' } }] });
      return ok({});
    });
    const gmail = new GmailConnector(http, { token: 'ya29' });
    expect((await gmail.listMessages())[0].id).toBe('m1');
    await gmail.unread();
    expect(http.lastRequest!.url).toContain('q=is%3Aunread');
    expect((await gmail.listLabels())[0].name).toBe('INBOX');
    expect((await gmail.listDrafts())[0].messageId).toBe('m9');
    expect((await gmail.attachments('me', 'm1'))[0].attachmentId).toBe('att1');
  });

  it('Calendar: calendars, events (with attendees), free/busy availability via POST', async () => {
    const http = new FakeHttpClient(
      router([
        ['/calendarList', { items: [{ id: 'primary', summary: 'Me', timeZone: 'UTC' }] }],
        ['/events', { items: [{ id: 'e1', summary: 'Standup', start: { dateTime: '2026-07-27T09:00:00Z' }, end: { dateTime: '2026-07-27T09:15:00Z' }, status: 'confirmed', attendees: [{ email: 'a@x' }] }] }],
        ['/freeBusy', { calendars: { primary: { busy: [{ start: 's', end: 'e' }] } } }],
      ]),
    );
    const cal = new CalendarConnector(http, { token: 'ya29' });
    expect((await cal.listCalendars())[0].id).toBe('primary');
    const events = await cal.listEvents('primary');
    expect(events[0].start).toBe('2026-07-27T09:00:00Z');
    expect(events[0].attendees).toEqual(['a@x']);
    expect((await cal.invitations())[0].id).toBe('e1');
    expect((await cal.availability('primary', 't0', 't1'))[0].start).toBe('s');
    expect(http.requests.find((r) => r.url.includes('/freeBusy'))!.method).toBe('POST');
  });

  it('Slack: channels, messages, reactions — and surfaces ok:false errors', async () => {
    const http = new FakeHttpClient((req) => {
      if (req.url.includes('conversations.list')) return ok({ ok: true, channels: [{ id: 'C1', name: 'general' }] });
      if (req.url.includes('conversations.history')) return ok({ ok: true, messages: [{ ts: '1.1', text: 'hi', user: 'U1' }] });
      if (req.url.includes('reactions.get')) return ok({ ok: true, message: { reactions: [{ name: 'thumbsup', count: 2 }] } });
      return ok({ ok: true });
    });
    const slack = new SlackConnector(http, { token: 'xoxb' });
    expect((await slack.listChannels())[0].name).toBe('general');
    expect((await slack.listMessages('C1'))[0].text).toBe('hi');
    expect((await slack.reactions('C1', '1.1'))[0].count).toBe(2);

    const bad = new SlackConnector(new FakeHttpClient(() => ok({ ok: false, error: 'invalid_auth' })), { token: 'x' });
    await expect(bad.listChannels()).rejects.toThrow(/slack error: invalid_auth/);
  });

  it('Jira: projects, issues (typed), boards', async () => {
    const http = new FakeHttpClient((req) => {
      if (req.url.includes('/project/search')) return ok({ values: [{ id: '1', key: 'NP', name: 'NeuroPause' }] });
      if (req.url.includes('/board')) return ok({ values: [{ id: 5, name: 'Board', type: 'scrum' }] });
      if (req.url.includes('/search')) return ok({ issues: [{ id: '10', key: 'NP-1', fields: { summary: 'Do it', issuetype: { name: 'Story' }, status: { name: 'To Do' } } }] });
      return ok({});
    });
    const jira = new JiraConnector(http, { baseUrl: 'https://np.atlassian.net', token: 'jt' });
    expect((await jira.listProjects())[0].key).toBe('NP');
    const issues = await jira.searchIssues('project = NP');
    expect(issues[0].type).toBe('Story');
    expect(issues[0].status).toBe('To Do');
    expect((await jira.stories('NP'))[0].key).toBe('NP-1');
    expect((await jira.listBoards())[0].name).toBe('Board');
  });

  it('Notion: search + databases with title extraction and Notion-Version header', async () => {
    const http = new FakeHttpClient((req) => {
      if (req.url.includes('/query')) return ok({ results: [{ id: 'row1', properties: { Name: { title: [{ plain_text: 'Task A' }] } } }] });
      if (req.url.includes('/search')) return ok({ results: [{ object: 'page', id: 'p1', url: 'https://notion/p1', properties: { Name: { title: [{ plain_text: 'Roadmap' }] } } }] });
      return ok({ results: [] });
    });
    const notion = new NotionConnector(http, { token: 'secret_x' });
    expect((await notion.search('road'))[0].title).toBe('Roadmap');
    expect(http.requests[0].headers?.['Notion-Version']).toBe('2022-06-28');
    expect((await notion.databases()).length).toBe(1);
    expect((await notion.queryDatabase('db1'))[0].title).toBe('Task A');
  });

  it('retries retryable 5xx and does NOT retry 4xx (Retry Test)', async () => {
    let calls = 0;
    const flaky = new FakeHttpClient(() => {
      calls += 1;
      if (calls < 3) return { status: 500, ok: false, headers: {}, body: 'err' };
      return ok([{ id: 1, name: 'r', full_name: 'o/r', private: false }]);
    });
    const gh = new GitHubConnector(flaky, { token: 'x' });
    expect((await gh.listRepos())[0].name).toBe('r');
    expect(calls).toBe(3); // two 500s retried, third succeeds

    const denied = new GitHubConnector(new FakeHttpClient(() => ({ status: 401, ok: false, headers: {}, body: 'unauthorized' })), { token: 'x' });
    await expect(denied.listRepos()).rejects.toThrow(); // 401 is not retryable
  });
});

describe('Module 10 — PostgreSQL connector (LIVE-VERIFIED against real embedded Postgres)', () => {
  let driver: SqlDriver;
  afterAll(async () => {
    if (driver) await driver.close();
  });

  it('discovers schema, runs read-only analytics, rejects writes, and pages incrementally', async () => {
    driver = await createPgliteDriver();
    await driver.exec(`CREATE TABLE items (id text primary key, version int, label text)`);
    await driver.exec(`INSERT INTO items VALUES ('a',1,'Alpha'),('b',2,'Beta'),('c',3,'Gamma')`);
    const pg = new PostgresConnector(driver);

    expect(await pg.ping()).toBe(true);
    expect(await pg.tables()).toContain('items');
    const schema = await pg.schema();
    expect(schema.some((c) => c.table === 'items' && c.column === 'label')).toBe(true);
    const rows = await pg.query<{ label: string }>(`SELECT label FROM items ORDER BY id`);
    expect(rows.map((r) => r.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
    await expect(pg.query(`DELETE FROM items`)).rejects.toThrow(/read-only/);
    await expect(pg.query(`UPDATE items SET label='x'`)).rejects.toThrow(/read-only/);

    // incremental cursor sync source (Sync Test — real DB)
    const src = pg.syncSource('items', { versionColumn: 'version' });
    const page1 = await src.pull(undefined, 2);
    expect(page1.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(page1.hasMore).toBe(true);
    const page2 = await src.pull(page1.nextCursor, 2);
    expect(page2.items.map((i) => i.id)).toEqual(['c']);
    expect(page2.hasMore).toBe(false);
    expect(page2.items[0].version).toBe(3);
  });
});
