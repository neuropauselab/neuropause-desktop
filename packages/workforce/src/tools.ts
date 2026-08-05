/**
 * Module 8 — Tool Runtime. Agents may use CRM, ERP, finance, HR, procurement, inventory,
 * manufacturing, workspace, search, documents, calendar, knowledge, and marketplace — but ONLY
 * through governed APIs, and every tool use is audited on the one chain. Tools read REAL data from
 * the reused Wave 8/10 platforms; nothing is fabricated, and no tool bypasses governance.
 */
import type { WorkforceGovernance } from './governance';
import type { WorkforceContext } from './types';
import { TOOL_DOMAINS, type ToolDomain } from './constants';

export interface ToolResult {
  domain: ToolDomain;
  op: string;
  data: unknown;
  available: boolean;
  note: string;
}

export class ToolRuntime {
  constructor(
    private readonly governance: WorkforceGovernance,
    private readonly ctx: WorkforceContext = {},
  ) {}

  domains(): readonly ToolDomain[] {
    return TOOL_DOMAINS;
  }

  async use(input: { worker: string; org: string; domain: ToolDomain; op: string; query?: string }): Promise<ToolResult> {
    if (!TOOL_DOMAINS.includes(input.domain)) throw new Error(`unknown tool domain: ${input.domain}`);
    const { data, available, note } = await this.dispatch(input.domain, input.query);
    await this.governance.record({ user: 'system', org: input.org, worker: input.worker, operation: `tool.${input.domain}.${input.op}`, targetId: input.domain, evidence: available ? 'live-verified' : 'business-data-pending', reasoning: note });
    return { domain: input.domain, op: input.op, data, available, note };
  }

  private async dispatch(domain: ToolDomain, query?: string): Promise<{ data: unknown; available: boolean; note: string }> {
    const b = this.ctx.business;
    const w = this.ctx.workplace;
    switch (domain) {
      case 'crm':
        return b ? { data: b.crm().counts(), available: true, note: 'real CRM data' } : this.unavailable();
      case 'finance':
      case 'erp':
        return b ? { data: { invoices: b.accounting().count(), journal: b.erp().count() }, available: true, note: 'real finance data' } : this.unavailable();
      case 'hr':
        return b ? { data: { employees: b.hr().count() }, available: true, note: 'real HR data' } : this.unavailable();
      case 'procurement':
        return b ? { data: { suppliers: b.procurement().suppliers().length }, available: true, note: 'real procurement data' } : this.unavailable();
      case 'inventory':
        return b ? { data: { movements: b.inventory().count() }, available: true, note: 'real inventory data' } : this.unavailable();
      case 'manufacturing':
        return b ? { data: { orders: b.manufacturing().count() }, available: true, note: 'real manufacturing data' } : this.unavailable();
      case 'search':
        return b ? { data: await b.intelligence().search(query ?? ''), available: true, note: 'real search' } : this.unavailable();
      case 'workspace':
        return w ? { data: { tasks: w.tasks().count() }, available: true, note: 'real workspace data' } : this.unavailable();
      case 'documents':
        return w ? { data: { documents: w.documents().count() }, available: true, note: 'real document data' } : this.unavailable();
      case 'calendar':
        return w ? { data: { events: w.calendar().count() }, available: true, note: 'real calendar data' } : this.unavailable();
      case 'knowledge':
        return w ? { data: { articles: w.knowledge().count() }, available: true, note: 'real knowledge data' } : this.unavailable();
      case 'marketplace':
        return w ? { data: { installed: w.marketplace().count() }, available: true, note: 'real marketplace data' } : this.unavailable();
      case 'connectors':
        return { data: null, available: false, note: 'connector execution is governed by the Wave 5 execution platform — not invoked here' };
    }
  }

  private unavailable(): { data: unknown; available: boolean; note: string } {
    return { data: null, available: false, note: 'tool unavailable — reused platform not connected in this context' };
  }
}
