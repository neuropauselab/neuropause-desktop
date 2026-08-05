/**
 * Module 16 — Enterprise Intelligence. Cross-enterprise metrics and a grounded copilot, composed
 * ONLY from real data in the reused platforms. It REUSES the Wave 8 business intelligence (copilot,
 * search, relationship graph) when a business platform is connected, and reads real counts from the
 * reused workforce and cloud-ops platforms. With nothing connected every answer is
 * 'No business data available' — never fabricated.
 */
import { NO_OPS_DATA } from './constants';
import type { OpsContext } from './types';

export interface EnterpriseMetrics {
  customers: number | string;
  aiAgents: number | string;
  liveVerifiedInfra: number | string;
  note: string;
}

export class EnterpriseIntelligence {
  constructor(private readonly ctx: OpsContext = {}) {}

  /** Real cross-platform metrics — each is a real count or 'No business data available'. */
  metrics(): EnterpriseMetrics {
    const customers = this.ctx.business ? this.ctx.business.crm().counts().accounts : 0;
    const aiAgents = this.ctx.workforce ? this.ctx.workforce.agents().count() : 0;
    const infra = this.ctx.cloudops ? this.ctx.cloudops.readiness().liveVerified : 0;
    const any = customers > 0 || aiAgents > 0 || infra > 0;
    return {
      customers: customers > 0 ? customers : NO_OPS_DATA,
      aiAgents: aiAgents > 0 ? aiAgents : NO_OPS_DATA,
      liveVerifiedInfra: infra > 0 ? infra : NO_OPS_DATA,
      note: any ? 'composed from real reused-platform data' : NO_OPS_DATA,
    };
  }

  /** Grounded copilot — delegates to the reused Wave 8 business intelligence; honest when absent. */
  async query(q: string): Promise<{ answer: string; grounded: boolean }> {
    const b = this.ctx.business;
    if (!b) return { answer: NO_OPS_DATA, grounded: false };
    const ans = await b.intelligence().copilot(q);
    return { answer: ans.answer, grounded: ans.grounded };
  }

  /** Relationship graph reused from Wave 8 — empty (honest) when no business platform is connected. */
  graph(): { nodes: number; edges: number; note: string } {
    const b = this.ctx.business;
    if (!b) return { nodes: 0, edges: 0, note: NO_OPS_DATA };
    const g = b.intelligence().graph();
    return { nodes: g.nodes, edges: g.edges, note: 'reused Wave 8 relationship graph' };
  }
}
