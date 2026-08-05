/**
 * Module 17 — Enterprise AI Layer. Indexes real business objects into the REUSED Wave 6
 * GlobalSearch (source-registry pattern), builds a relationship graph, and answers a copilot
 * query grounded ONLY in real in-process objects — returning 'No business data available' when
 * there is nothing to answer from. Lexical search + graph are live-verified; deep neural
 * reasoning is not run here and is not claimed.
 */
import { GlobalSearch, type SearchSource, type GlobalSearchResult } from '@neuropause/federation';
import { NO_BUSINESS_DATA } from './constants';
import type { CrmRuntime } from './crm';
import type { HrRuntime } from './hr';
import type { ProcurementRuntime } from './procurement';
import type { ProjectRuntime } from './projects';
import type { AssetRuntime } from './assets';

export interface BusinessGraph {
  nodes: number;
  edges: number;
  edgesByType: Record<string, number>;
}
export interface CopilotAnswer {
  answer: string;
  hits: GlobalSearchResult['hits'];
  grounded: boolean;
}

export interface IntelligenceDeps {
  crm: CrmRuntime;
  hr: HrRuntime;
  procurement: ProcurementRuntime;
  projects: ProjectRuntime;
  assets: AssetRuntime;
}

const matches = (text: string, q: string): boolean => text.toLowerCase().includes(q.toLowerCase());

export class BusinessIntelligence {
  private readonly index = new GlobalSearch();

  constructor(private readonly deps: IntelligenceDeps) {
    this.index.register(this.crmSource());
    this.index.register(this.hrSource());
    this.index.register(this.procurementSource());
    this.index.register(this.projectSource());
    this.index.register(this.assetSource());
  }

  private crmSource(): SearchSource {
    return {
      id: 'crm',
      search: (q, limit) => [
        ...this.deps.crm.accounts().filter((a) => matches(a.name, q)).map((a) => ({ source: 'crm', type: 'account', id: a.id, title: a.name })),
        ...this.deps.crm.opportunities().filter((o) => matches(o.name, q)).map((o) => ({ source: 'crm', type: 'opportunity', id: o.id, title: o.name })),
      ].slice(0, limit),
    };
  }
  private hrSource(): SearchSource {
    return { id: 'hr', search: (q, limit) => this.deps.hr.employees().filter((e) => matches(e.name, q)).slice(0, limit).map((e) => ({ source: 'hr', type: 'employee', id: e.id, title: e.name })) };
  }
  private procurementSource(): SearchSource {
    return { id: 'procurement', search: (q, limit) => this.deps.procurement.suppliers().filter((s) => matches(s.name, q)).slice(0, limit).map((s) => ({ source: 'procurement', type: 'supplier', id: s.id, title: s.name })) };
  }
  private projectSource(): SearchSource {
    return { id: 'projects', search: (q, limit) => this.deps.projects.projects().filter((p) => matches(p.name, q)).slice(0, limit).map((p) => ({ source: 'projects', type: 'project', id: p.id, title: p.name })) };
  }
  private assetSource(): SearchSource {
    return { id: 'assets', search: (q, limit) => this.deps.assets.assets().filter((a) => matches(a.name, q)).slice(0, limit).map((a) => ({ source: 'assets', type: 'asset', id: a.id, title: a.name })) };
  }

  async search(query: string, opts: { sources?: string[]; limit?: number } = {}): Promise<GlobalSearchResult> {
    return this.index.search(query, opts);
  }
  sources(): string[] {
    return this.index.sourceIds();
  }

  /** A relationship graph over real business objects (contact→account, opportunity→account, task→project). */
  graph(): BusinessGraph {
    const contactAccount = this.deps.crm.contacts().filter((c) => c.accountId).length;
    const opportunityAccount = this.deps.crm.opportunities().length; // every opportunity references an account
    const taskProject = this.deps.projects.tasks().length; // every task references a project
    const edgesByType: Record<string, number> = {};
    if (contactAccount) edgesByType['contact-account'] = contactAccount;
    if (opportunityAccount) edgesByType['opportunity-account'] = opportunityAccount;
    if (taskProject) edgesByType['task-project'] = taskProject;
    const edges = contactAccount + opportunityAccount + taskProject;
    const nodes = this.deps.crm.accounts().length + this.deps.crm.contacts().length + this.deps.crm.opportunities().length + this.deps.projects.projects().length + this.deps.projects.tasks().length;
    return { nodes, edges, edgesByType };
  }

  totalObjects(): number {
    const c = this.deps.crm.counts();
    return c.accounts + c.contacts + c.leads + c.opportunities + this.deps.hr.count() + this.deps.procurement.count() + this.deps.projects.count() + this.deps.assets.count();
  }

  /** Copilot grounded only in real objects — never fabricates an answer. */
  async copilot(query: string): Promise<CopilotAnswer> {
    if (this.totalObjects() === 0) return { answer: NO_BUSINESS_DATA, hits: [], grounded: false };
    const res = await this.search(query);
    if (res.total === 0) return { answer: 'No matching business objects found.', hits: [], grounded: true };
    return { answer: `Found ${res.total} business object(s) matching "${query}".`, hits: res.hits, grounded: true };
  }
}
