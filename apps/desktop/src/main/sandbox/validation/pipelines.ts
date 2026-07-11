/**
 * AI Sandbox — Continuous Validation Platform (S6): the pipeline catalog.
 *
 * 13 reusable pipelines (Step 3), each COMPOSED from S1–S5 stages — scenario (S3/S2), AI QA
 * (S4), or lab (S5). The pipelines add no new scenarios; they reuse the S4 templates and the
 * S5 lab. A stage carries only config; the runner dispatches it to the existing executor.
 */
import type { PipelineKind, PipelineStage, ScenarioSpec, ValidationPipeline } from '@neuropause/shared';
import {
  automationCheck,
  connectorCheck,
  crmSmoke,
  desktopSmoke,
  developerChannels,
  financeFlow,
  inventoryFlow,
  pluginCheck,
  procureToPay,
} from '../agent/scenarioTemplates';
import type { LabRunConfig } from '../lab';

function scenario(id: string, name: string, spec: ScenarioSpec, optional = false): PipelineStage {
  return { id, name, kind: 'scenario', config: { spec }, optional };
}
function aiQa(id: string, name: string, goal: string): PipelineStage {
  return { id, name, kind: 'ai-qa', config: { goal } };
}
function lab(id: string, name: string, labConfig: LabRunConfig): PipelineStage {
  return { id, name, kind: 'lab', config: { labConfig } };
}

/* Focused lab configs (skip sections with empty arrays). */
const PERF_ONLY: LabRunConfig = { iterations: 1, chaos: [], security: [], recovery: [] };
const SECURITY_ONLY: LabRunConfig = { iterations: 1, profiles: [], load: [], stress: [], chaos: [] };
const RESILIENCE_ONLY: LabRunConfig = { iterations: 1, profiles: [], load: [], stress: [], security: [] };
const FULL_LAB: LabRunConfig = { iterations: 1 };

export const PIPELINES: Record<PipelineKind, ValidationPipeline> = {
  quick: { kind: 'quick', name: 'Quick Validation', description: 'A single fast smoke scenario.', certifies: false, stages: [scenario('crm', 'CRM smoke', crmSmoke())] },
  smoke: { kind: 'smoke', name: 'Smoke Validation', description: 'Core cross-domain smoke.', certifies: false, stages: [scenario('crm', 'CRM smoke', crmSmoke()), scenario('dev', 'Developer channels', developerChannels())] },
  regression: { kind: 'regression', name: 'Regression Validation', description: 'AI-driven regression sweep.', certifies: false, stages: [aiQa('regression', 'Regression QA', 'Run the full regression suite')] },
  performance: { kind: 'performance', name: 'Performance Validation', description: 'Performance profiles + load + stress.', certifies: false, stages: [lab('perf', 'Performance lab', PERF_ONLY)] },
  security: { kind: 'security', name: 'Security Validation', description: 'Security controls enforced through the real security.', certifies: false, stages: [lab('sec', 'Security lab', SECURITY_ONLY), aiQa('sec-qa', 'Security QA', 'Validate RBAC enforcement')] },
  enterprise: { kind: 'enterprise', name: 'Enterprise Validation', description: 'End-to-end ERP flows.', certifies: false, stages: [scenario('p2p', 'Procure to pay', procureToPay()), scenario('o2c', 'Order to cash', financeFlow()), scenario('inv', 'Inventory', inventoryFlow())] },
  connector: { kind: 'connector', name: 'Connector Validation', description: 'Connector sync + health.', certifies: false, stages: [scenario('conn', 'Connector sync', connectorCheck('github'))] },
  plugin: { kind: 'plugin', name: 'Plugin Validation', description: 'Plugin registration.', certifies: false, stages: [scenario('plugin', 'Plugin registered', pluginCheck('sample-plugin'), true)] },
  sdk: { kind: 'sdk', name: 'SDK Validation', description: 'SDK developer channel.', certifies: false, stages: [scenario('sdk', 'SDK', developerChannels())] },
  cli: { kind: 'cli', name: 'CLI Validation', description: 'CLI developer channel.', certifies: false, stages: [scenario('cli', 'CLI', developerChannels())] },
  desktop: { kind: 'desktop', name: 'Desktop Validation', description: 'Desktop UI smoke (S2).', certifies: false, stages: [scenario('desktop', 'Desktop smoke', desktopSmoke(), true)] },
  'release-candidate': {
    kind: 'release-candidate', name: 'Release Candidate Validation', description: 'Smoke + regression + resilience for an RC.', certifies: true,
    stages: [scenario('smoke', 'Smoke', crmSmoke()), aiQa('regression', 'Regression QA', 'Run the full regression suite'), scenario('automation', 'Automation', automationCheck('rule-1')), lab('resilience', 'Resilience lab', RESILIENCE_ONLY)],
  },
  certification: {
    kind: 'certification', name: 'Certification Validation', description: 'Full enterprise + AI QA + performance + security for release certification.', certifies: true,
    stages: [scenario('p2p', 'Procure to pay', procureToPay()), scenario('o2c', 'Order to cash', financeFlow()), aiQa('regression', 'Regression QA', 'Run the full regression suite'), aiQa('security', 'Security QA', 'Validate RBAC enforcement'), lab('full', 'Full lab', FULL_LAB)],
  },
};

export const PIPELINE_LIST: ValidationPipeline[] = Object.values(PIPELINES);

export function getPipeline(kind: PipelineKind): ValidationPipeline {
  return PIPELINES[kind];
}
