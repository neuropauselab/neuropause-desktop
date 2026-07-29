/**
 * Module 4 — GitHub connector. REST v3 adapter over the transport seam. Covers the
 * core resource set (repos, pull requests, issues, commits, branches, tags, releases,
 * workflows, workflow runs, org members). Discussions and Projects v2 are GitHub
 * GraphQL-only and are documented extensions (see the evidence matrix), not faked.
 */
import type { HttpClient } from '@neuropause/integrations';
import { HttpConnector, pickArray, str, num, type TransportOptions } from '../httpConnector';

export interface GhRepo { id: number; name: string; fullName: string; private: boolean; }
export interface GhPull { number: number; title: string; state: string; }
export interface GhIssue { number: number; title: string; state: string; }
export interface GhCommit { sha: string; message: string; author: string; }
export interface GhRef { name: string; }
export interface GhRelease { id: number; tag: string; name: string; }
export interface GhWorkflow { id: number; name: string; state: string; }
export interface GhWorkflowRun { id: number; name: string; status: string; conclusion: string; }
export interface GhMember { id: number; login: string; }

const rec = (row: Record<string, unknown>, key: string): Record<string, unknown> => (row[key] as Record<string, unknown>) ?? {};

export class GitHubConnector extends HttpConnector {
  constructor(http: HttpClient, opts: Partial<TransportOptions> & { token?: string } = {}) {
    super(http, { baseUrl: opts.baseUrl ?? 'https://api.github.com', headers: { 'X-GitHub-Api-Version': '2022-11-28' }, ...opts });
  }

  listRepos(opts: { perPage?: number; page?: number } = {}): Promise<GhRepo[]> {
    return this.listMapped('/user/repos', pickArray(), (r) => ({ id: num(r.id), name: str(r.name), fullName: str(r.full_name), private: Boolean(r.private) }), { per_page: opts.perPage ?? 30, page: opts.page ?? 1 });
  }
  listPullRequests(owner: string, repo: string, state = 'open'): Promise<GhPull[]> {
    return this.listMapped(`/repos/${owner}/${repo}/pulls`, pickArray(), (r) => ({ number: num(r.number), title: str(r.title), state: str(r.state) }), { state });
  }
  listIssues(owner: string, repo: string, state = 'open'): Promise<GhIssue[]> {
    return this.listMapped(`/repos/${owner}/${repo}/issues`, pickArray(), (r) => ({ number: num(r.number), title: str(r.title), state: str(r.state) }), { state });
  }
  listCommits(owner: string, repo: string): Promise<GhCommit[]> {
    return this.listMapped(`/repos/${owner}/${repo}/commits`, pickArray(), (r) => ({ sha: str(r.sha), message: str(rec(r, 'commit').message), author: str(rec(rec(r, 'commit'), 'author').name) }));
  }
  listBranches(owner: string, repo: string): Promise<GhRef[]> {
    return this.listMapped(`/repos/${owner}/${repo}/branches`, pickArray(), (r) => ({ name: str(r.name) }));
  }
  listTags(owner: string, repo: string): Promise<GhRef[]> {
    return this.listMapped(`/repos/${owner}/${repo}/tags`, pickArray(), (r) => ({ name: str(r.name) }));
  }
  listReleases(owner: string, repo: string): Promise<GhRelease[]> {
    return this.listMapped(`/repos/${owner}/${repo}/releases`, pickArray(), (r) => ({ id: num(r.id), tag: str(r.tag_name), name: str(r.name) }));
  }
  listWorkflows(owner: string, repo: string): Promise<GhWorkflow[]> {
    return this.listMapped(`/repos/${owner}/${repo}/actions/workflows`, pickArray('workflows'), (r) => ({ id: num(r.id), name: str(r.name), state: str(r.state) }));
  }
  listWorkflowRuns(owner: string, repo: string): Promise<GhWorkflowRun[]> {
    return this.listMapped(`/repos/${owner}/${repo}/actions/runs`, pickArray('workflow_runs'), (r) => ({ id: num(r.id), name: str(r.name), status: str(r.status), conclusion: str(r.conclusion) }));
  }
  listOrgMembers(org: string): Promise<GhMember[]> {
    return this.listMapped(`/orgs/${org}/members`, pickArray(), (r) => ({ id: num(r.id), login: str(r.login) }));
  }
}
