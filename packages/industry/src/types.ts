/**
 * Wave 9 shared types. Reuses the four-level EvidenceLevel from Wave 8 (composition, not
 * duplication). An IndustrySolution is a DECLARATION that composes on the Wave 8 business
 * platform — it reuses domains (crm/erp/hr/manufacturing/…) rather than reimplementing them.
 */
import type { EvidenceLevel } from '@neuropause/business';
import type { BusinessPlatform } from '@neuropause/business';

export type { EvidenceLevel };

/** The context an industry KPI computes over — real data from the reused Wave 8 platform. */
export interface IndustryContext {
  business?: BusinessPlatform;
}

export interface CustomObjectDef {
  name: string;
  fields: Array<{ name: string; type: 'text' | 'number' | 'date' | 'boolean' | 'reference' }>;
  /** the Wave 8 domain this object composes on (reused, never duplicated). */
  reusesDomain: string;
}
export interface WorkflowDef {
  name: string;
  steps: string[];
  requiresApproval: boolean;
}
export interface FormDef {
  name: string;
  objectName: string;
  fields: string[];
}
export interface DashboardDef {
  name: string;
  widgets: string[];
}
export interface ReportDef {
  name: string;
  source: string;
  columns: string[];
}
export interface KpiDef {
  name: string;
  unit: string;
  /** computes over REAL data from the reused business platform — 0 when empty, never fabricated. */
  compute: (ctx: IndustryContext) => number;
}
export interface ConnectorRef {
  system: string;
  category: string;
}
export interface CompliancePackRef {
  pack: string;
}
export interface DocumentTemplateDef {
  name: string;
  format: 'pdf' | 'docx' | 'html';
  sections: string[];
}
export interface AiSkillDef {
  name: string;
  description: string;
}
export interface AutomationPackDef {
  name: string;
  triggers: string[];
}

/** A vertical solution: a bundle of declarations composed over reused Wave 8 domains. */
export interface IndustrySolution {
  key: string;
  name: string;
  /** Wave 8 domains reused — NEVER duplicated. */
  reusesDomains: string[];
  objects: CustomObjectDef[];
  workflows: WorkflowDef[];
  kpis: KpiDef[];
  compliancePacks: CompliancePackRef[];
  connectors: ConnectorRef[];
  aiSkills: AiSkillDef[];
  documentTemplates: DocumentTemplateDef[];
}
