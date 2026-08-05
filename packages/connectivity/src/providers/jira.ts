/**
 * Module 8 — Jira connector. Jira Cloud REST v3 + Agile adapter over the transport
 * seam. Covers projects, issues (epics/stories/tasks/bugs via issuetype JQL), sprints,
 * boards, and comments. baseUrl is the Atlassian site (https://<site>.atlassian.net).
 */
import type { HttpClient } from '@neuropause/integrations';
import { HttpConnector, pickArray, str, type TransportOptions } from '../httpConnector';

export interface JiraProject { id: string; key: string; name: string; }
export interface JiraIssue { id: string; key: string; summary: string; type: string; status: string; }
export interface JiraBoard { id: number; name: string; type: string; }
export interface JiraSprint { id: number; name: string; state: string; }
export interface JiraComment { id: string; author: string; body: string; }

const rec = (row: Record<string, unknown>, key: string): Record<string, unknown> => (row[key] as Record<string, unknown>) ?? {};

function mapIssue(r: Record<string, unknown>): JiraIssue {
  const f = rec(r, 'fields');
  return { id: str(r.id), key: str(r.key), summary: str(f.summary), type: str(rec(f, 'issuetype').name), status: str(rec(f, 'status').name) };
}

export class JiraConnector extends HttpConnector {
  constructor(http: HttpClient, opts: Partial<TransportOptions> & { token?: string; baseUrl: string }) {
    super(http, opts);
  }

  listProjects(): Promise<JiraProject[]> {
    return this.listMapped('/rest/api/3/project/search', pickArray('values'), (r) => ({ id: str(r.id), key: str(r.key), name: str(r.name) }));
  }
  searchIssues(jql: string, opts: { maxResults?: number } = {}): Promise<JiraIssue[]> {
    return this.listMapped('/rest/api/3/search', pickArray('issues'), mapIssue, { jql, maxResults: opts.maxResults ?? 50 });
  }
  epics(projectKey: string): Promise<JiraIssue[]> {
    return this.searchIssues(`project = "${projectKey}" AND issuetype = Epic`);
  }
  stories(projectKey: string): Promise<JiraIssue[]> {
    return this.searchIssues(`project = "${projectKey}" AND issuetype = Story`);
  }
  bugs(projectKey: string): Promise<JiraIssue[]> {
    return this.searchIssues(`project = "${projectKey}" AND issuetype = Bug`);
  }
  listBoards(): Promise<JiraBoard[]> {
    return this.listMapped('/rest/agile/1.0/board', pickArray('values'), (r) => ({ id: Number(r.id), name: str(r.name), type: str(r.type) }));
  }
  listSprints(boardId: number): Promise<JiraSprint[]> {
    return this.listMapped(`/rest/agile/1.0/board/${boardId}/sprint`, pickArray('values'), (r) => ({ id: Number(r.id), name: str(r.name), state: str(r.state) }));
  }
  listComments(issueKey: string): Promise<JiraComment[]> {
    return this.listMapped(`/rest/api/3/issue/${issueKey}/comment`, pickArray('comments'), (r) => ({ id: str(r.id), author: str(rec(r, 'author').displayName), body: str(r.body) }));
  }
}
