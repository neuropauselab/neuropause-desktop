/**
 * Module 4 — Executive AI Copilots. ONE engine, seven role configs (CEO/CTO/CPO/CRO/
 * CMO/CFO/COO). Each copilot exposes a dashboard, daily/weekly brief, alerts,
 * recommendations, an action queue, and an evidence panel — all scoped to the role's
 * concerns and grounded in real graph evidence. The brief runs through the governed
 * AnswerEngine (audited + evidence-referenced + confidence). Roles with no live data
 * source (e.g. revenue/customers) surface that honestly rather than inventing numbers.
 */
import type { EvidenceRef, AiAnswer, EntityType } from './types';
import type { KnowledgeGraph } from './graph';
import type { EnterpriseTimeline } from './timeline';
import type { ReasoningEngine } from './reasoning';
import type { IntelligenceServices, Finding } from './intelligence';
import type { AnswerEngine } from './engine';
import { EXECUTIVE_ROLES, type ExecutiveRole } from './constants';

export interface CopilotDeps {
  graph: KnowledgeGraph;
  timeline: EnterpriseTimeline;
  reasoning: ReasoningEngine;
  intelligence: IntelligenceServices;
  answerEngine: AnswerEngine;
}

interface RoleConfig {
  focus: string;
  types: EntityType[]; // empty = all
}

const ROLE_CONFIG: Record<ExecutiveRole, RoleConfig> = {
  CEO: { focus: 'company health and strategy', types: [] },
  CTO: { focus: 'engineering, OKRs, and connector health', types: ['objective', 'key_result', 'task', 'connector'] },
  CPO: { focus: 'product objectives, dashboards, and tasks', types: ['objective', 'task', 'dashboard'] },
  CRO: { focus: 'revenue and customers', types: ['customer', 'objective'] },
  CMO: { focus: 'marketing objectives and reach', types: ['objective'] },
  CFO: { focus: 'financial objectives and AI cost', types: ['objective'] },
  COO: { focus: 'operations, connectors, and execution', types: ['connector', 'task', 'objective'] },
};

export interface Alert {
  severity: 'high' | 'medium';
  label: string;
  entityId?: string;
  evidence: EvidenceRef[];
}

export interface ActionItem {
  label: string;
  entityId: string;
  status: string;
}

export class ExecutiveCopilot {
  constructor(
    readonly role: ExecutiveRole,
    private readonly config: RoleConfig,
    private readonly deps: CopilotDeps,
  ) {}

  private scopedEntities(tenantId: string) {
    const all = this.deps.graph.list(tenantId);
    return this.config.types.length === 0 ? all : all.filter((e) => this.config.types.includes(e.type));
  }
  private roleEvidence(tenantId: string): EvidenceRef[] {
    return this.scopedEntities(tenantId).slice(0, 25).flatMap((e) => e.evidence);
  }

  dashboard(tenantId: string): { role: ExecutiveRole; focus: string; metrics: Record<string, number>; insights: string[] } {
    const ents = this.scopedEntities(tenantId);
    const objectives = ents.filter((e) => e.type === 'objective');
    const avgProgress = objectives.length ? Math.round(objectives.reduce((a, o) => a + Number(o.metadata.progress ?? 0), 0) / objectives.length) : 0;
    const risks = this.deps.intelligence.risk(tenantId).findings.length;
    return {
      role: this.role,
      focus: this.config.focus,
      metrics: { entities: ents.length, objectives: objectives.length, avgObjectiveProgress: avgProgress, risks },
      insights: this.deps.intelligence.recommendation(tenantId).findings.slice(0, 3).map((f) => f.label),
    };
  }

  async brief(tenantId: string, actor: string, period: 'daily' | 'weekly'): Promise<AiAnswer> {
    const evidence = [...this.roleEvidence(tenantId), ...this.deps.intelligence.risk(tenantId).findings.flatMap((f) => f.evidence)];
    return this.deps.answerEngine.answer({
      tenantId,
      actor,
      kind: `copilot.${this.role}.${period}`,
      question: `As the ${this.role}, give me the ${period} brief focused on ${this.config.focus}.`,
      evidence,
    });
  }

  alerts(tenantId: string): Alert[] {
    const scoped = new Set(this.scopedEntities(tenantId).map((e) => e.id));
    return this.deps.intelligence
      .risk(tenantId)
      .findings.filter((f) => this.config.types.length === 0 || (f.entityId !== undefined && scoped.has(f.entityId)))
      .map((f) => ({ severity: 'high' as const, label: f.label, ...(f.entityId ? { entityId: f.entityId } : {}), evidence: f.evidence }));
  }

  recommendations(tenantId: string): Finding[] {
    return this.deps.intelligence.recommendation(tenantId).findings;
  }

  actionQueue(tenantId: string): ActionItem[] {
    return this.scopedEntities(tenantId)
      .filter((e) => (e.type === 'objective' && ['at-risk', 'behind', 'planned'].includes(String(e.metadata.status))) || (e.type === 'task' && e.metadata.status !== 'done'))
      .slice(0, 20)
      .map((e) => ({ label: e.label, entityId: e.id, status: String(e.metadata.status ?? 'open') }));
  }

  evidencePanel(tenantId: string): EvidenceRef[] {
    return this.roleEvidence(tenantId);
  }
}

export class CopilotSuite {
  private readonly copilots: Map<ExecutiveRole, ExecutiveCopilot>;

  constructor(deps: CopilotDeps) {
    this.copilots = new Map(EXECUTIVE_ROLES.map((role) => [role, new ExecutiveCopilot(role, ROLE_CONFIG[role], deps)]));
  }
  copilot(role: ExecutiveRole): ExecutiveCopilot {
    return this.copilots.get(role)!;
  }
  roles(): ExecutiveRole[] {
    return [...EXECUTIVE_ROLES];
  }
}
