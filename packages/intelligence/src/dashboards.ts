/**
 * Module 13 — Executive Dashboards. One dashboard per role, composing the copilots +
 * intelligence services + graph into panels: company health, engineering, revenue,
 * customers, projects, risks, compliance, AI insights. Panels with no live data source
 * (revenue, compliance) show "no live data" rather than a fabricated figure.
 */
import type { KnowledgeGraph } from './graph';
import type { IntelligenceServices, Finding } from './intelligence';
import type { CopilotSuite } from './copilots';
import type { ExecutiveRole } from './constants';

export interface DashboardPanel {
  value: number | string;
  detail: string;
}

export interface ExecutiveDashboard {
  role: ExecutiveRole;
  tenantId: string;
  panels: Record<string, DashboardPanel>;
  insights: Finding[];
}

export interface DashboardDeps {
  graph: KnowledgeGraph;
  intelligence: IntelligenceServices;
  copilots: CopilotSuite;
}

export class ExecutiveDashboards {
  constructor(private readonly deps: DashboardDeps) {}

  build(role: ExecutiveRole, tenantId: string): ExecutiveDashboard {
    const g = this.deps.graph;
    const objectives = g.list(tenantId, 'objective');
    const avg = objectives.length ? Math.round(objectives.reduce((a, o) => a + Number(o.metadata.progress ?? 0), 0) / objectives.length) : 0;
    const risks = this.deps.intelligence.risk(tenantId).findings.length;
    const customers = g.list(tenantId, 'customer').length;
    const tasks = g.list(tenantId, 'task').length;
    const recommendations = this.deps.intelligence.recommendation(tenantId).findings.length;
    const health = Math.max(0, Math.min(100, avg - risks * 10));

    const panels: Record<string, DashboardPanel> = {
      companyHealth: { value: health, detail: `OKR avg ${avg}% minus ${risks} risk(s)` },
      engineering: { value: objectives.length, detail: `${avg}% average objective progress` },
      revenue: { value: 'no live data', detail: 'revenue connector infra-pending (no fabricated figure)' },
      customers: { value: customers, detail: customers ? 'from the knowledge graph' : 'no live customer data yet' },
      projects: { value: tasks, detail: `${tasks} task(s) tracked` },
      risks: { value: risks, detail: 'risks detected by intelligence services' },
      compliance: { value: 'no live data', detail: 'compliance controls not connected (infra-pending)' },
      aiInsights: { value: recommendations, detail: 'AI recommendations available' },
    };

    return { role, tenantId, panels, insights: this.deps.copilots.copilot(role).recommendations(tenantId).slice(0, 5) };
  }
}
