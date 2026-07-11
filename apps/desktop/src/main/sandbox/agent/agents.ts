/**
 * AI Sandbox — AI QA Agent (S4): the 15 production agents.
 *
 * Agents are DATA — a definition (goals / capabilities / constraints) plus a set of
 * checks (each a scenario template + expectations). They add no engine and no automation;
 * the framework runs them uniformly and every check is executed through the existing
 * S1/S2/S3 executors. Constraints declare the RBAC an agent needs (enforced by the
 * executors) and whether it may run destructive tasks without approval.
 */
import type {
  QaAgentCategory,
  QaAgentDefinition,
  QaExpectation,
  QaPriority,
  ScenarioSpec,
} from '@neuropause/shared';
import {
  automationCheck,
  connectorCheck,
  crmSmoke,
  desktopSmoke,
  developerChannels,
  executiveCheck,
  financeFlow,
  inventoryFlow,
  knowledgeGraphCheck,
  manufacturingFlow,
  planningCheck,
  pluginCheck,
  procureToPay,
  securityRbac,
  timelineCheck,
} from './scenarioTemplates';

export interface QaCheck {
  id: string;
  name: string;
  priority: QaPriority;
  destructive: boolean;
  dependsOn: string[];
  spec: ScenarioSpec;
  expectations: QaExpectation[];
}

function check(id: string, name: string, priority: QaPriority, spec: ScenarioSpec, expectations: string[], opts: { destructive?: boolean; dependsOn?: string[] } = {}): QaCheck {
  return { id, name, priority, destructive: opts.destructive ?? false, dependsOn: opts.dependsOn ?? [], spec, expectations: expectations.map((description) => ({ description })) };
}

const CAP = (id: string, description: string): { id: string; description: string } => ({ id, description });

const DEFAULT_CONSTRAINTS = { allowDestructive: false, maxTasks: 20 };

function def(category: QaAgentCategory, name: string, description: string, goals: string[], capabilities: { id: string; description: string }[], allowedChannels: string[], requiredPermissions: string[]): QaAgentDefinition {
  return { id: `qa-${category}`, category, name, description, goals, capabilities, constraints: { ...DEFAULT_CONSTRAINTS, allowedChannels, requiredPermissions } };
}

export const QA_AGENTS: Record<QaAgentCategory, QaAgentDefinition> = {
  regression: def('regression', 'Regression QA Agent', 'Runs a broad cross-domain smoke suite to catch regressions.',
    ['Run the full regression suite', 'Smoke-test every core domain'],
    [CAP('cross-domain', 'Exercises CRM, procurement, finance and developer channels'), CAP('regression-detect', 'Flags newly failing scenarios')],
    ['module', 'rest', 'sdk', 'cli'], ['sandbox:read', 'sandbox:manage']),
  erp: def('erp', 'ERP QA Agent', 'Validates end-to-end ERP flows (procure-to-pay, order-to-cash, inventory).',
    ['Validate procure to pay', 'Validate order to cash'],
    [CAP('p2p', 'Procure-to-pay lifecycle'), CAP('o2c', 'Order-to-cash lifecycle')],
    ['module'], ['sandbox:manage']),
  crm: def('crm', 'CRM QA Agent', 'Validates CRM customer/lead lifecycles.',
    ['Validate the customer lifecycle'], [CAP('customer', 'Customer create/update/timeline')], ['module'], ['crm:manage']),
  manufacturing: def('manufacturing', 'Manufacturing QA Agent', 'Validates production order planning and completion.',
    ['Validate production order planning'], [CAP('production', 'Production order lifecycle')], ['module'], ['manufacturing:manage']),
  inventory: def('inventory', 'Inventory QA Agent', 'Validates product creation and stock movements.',
    ['Validate inventory movements'], [CAP('stock', 'Product + stock issue')], ['module'], ['inventory:manage']),
  planning: def('planning', 'Planning QA Agent', 'Validates MRP/APS planning engines run and return results.',
    ['Run MRP and APS'], [CAP('mrp', 'MRP + APS computation')], ['planning'], ['operations:read']),
  finance: def('finance', 'Finance QA Agent', 'Validates invoicing and payments.',
    ['Validate order to cash'], [CAP('o2c', 'Invoice + payment')], ['module'], ['sales:manage']),
  'developer-portal': def('developer-portal', 'Developer Portal QA Agent', 'Validates the REST/SDK/CLI developer channels.',
    ['Smoke-test the developer channels'], [CAP('sdk', 'SDK'), CAP('cli', 'CLI'), CAP('rest', 'REST')], ['rest', 'sdk', 'cli'], ['sandbox:read']),
  plugin: def('plugin', 'Plugin QA Agent', 'Validates plugin registration.',
    ['Verify plugins are registered'], [CAP('registry', 'Plugin registry')], ['plugin'], ['sandbox:read']),
  connector: def('connector', 'Connector QA Agent', 'Validates connector sync + health.',
    ['Verify connectors sync'], [CAP('sync', 'Connector sync')], ['connector'], ['sandbox:read']),
  automation: def('automation', 'Automation QA Agent', 'Validates automation rules execute.',
    ['Verify automations run'], [CAP('rule', 'Automation rule execution')], ['automation'], ['operations:read']),
  security: def('security', 'Security QA Agent', 'Validates RBAC grants and denials are enforced.',
    ['Validate RBAC enforcement'], [CAP('rbac', 'Permission grants + denials')], ['module'], ['sandbox:read']),
  executive: def('executive', 'Executive QA Agent', 'Validates executive KPIs react to changes.',
    ['Verify KPIs update'], [CAP('kpi', 'Executive KPI reactivity')], ['module'], ['dashboard:read']),
  'knowledge-graph': def('knowledge-graph', 'Knowledge Graph QA Agent', 'Validates records surface as graph nodes.',
    ['Verify graph projection'], [CAP('projection', 'ERP → graph node')], ['module'], ['intelligence:read']),
  timeline: def('timeline', 'Timeline QA Agent', 'Validates record changes surface timeline events.',
    ['Verify timeline events'], [CAP('events', 'Record → timeline event')], ['module'], ['intelligence:read']),
};

export const AGENT_CHECKS: Record<QaAgentCategory, QaCheck[]> = {
  regression: [
    check('crm', 'CRM smoke', 'p1', crmSmoke(), ['Customer created', 'Customer updated', 'Timeline + graph updated']),
    check('p2p', 'Procure to pay', 'p1', procureToPay(), ['PO approved', 'KPI reacts']),
    check('finance', 'Order to cash', 'p1', financeFlow(), ['Invoice created', 'Payment received']),
    check('dev', 'Developer channels', 'p2', developerChannels(), ['SDK ok', 'CLI ok', 'REST ok']),
  ],
  erp: [
    check('p2p', 'Procure to pay', 'p0', procureToPay(), ['PO approved', 'KPI reacts']),
    check('o2c', 'Order to cash', 'p1', financeFlow(), ['Invoice created', 'Payment received']),
    check('inv', 'Inventory movement', 'p2', inventoryFlow(), ['Product created', 'Stock issued']),
  ],
  crm: [check('crm', 'Customer lifecycle', 'p0', crmSmoke(), ['Customer created', 'Customer updated', 'Timeline + graph updated'])],
  manufacturing: [check('mo', 'Production order', 'p0', manufacturingFlow(), ['Production order planned'])],
  inventory: [check('inv', 'Product + issue', 'p0', inventoryFlow(), ['Product created', 'Stock issued'])],
  planning: [check('mrp', 'MRP + APS', 'p1', planningCheck(), ['MRP ran', 'APS ran'])],
  finance: [check('o2c', 'Order to cash', 'p0', financeFlow(), ['Invoice created', 'Payment received'])],
  'developer-portal': [check('dev', 'SDK/CLI/REST', 'p1', developerChannels(), ['SDK ok', 'CLI ok', 'REST ok'])],
  plugin: [check('plugin', 'Plugin registered', 'p2', pluginCheck('sample-plugin'), ['Plugin registered'])],
  connector: [check('conn', 'Connector sync', 'p2', connectorCheck('github'), ['Connector synced'])],
  automation: [check('auto', 'Automation run', 'p1', automationCheck('rule-1'), ['Automation executed'])],
  security: [check('rbac', 'RBAC enforcement', 'p0', securityRbac('sandbox:read', 'nonexistent:permission'), ['Granted permission allowed', 'Denied permission blocked'])],
  executive: [check('kpi', 'KPI reactivity', 'p1', executiveCheck(), ['KPI changed'])],
  'knowledge-graph': [check('kg', 'Graph projection', 'p1', knowledgeGraphCheck(), ['Graph node created'])],
  timeline: [check('tl', 'Timeline events', 'p1', timelineCheck(), ['Timeline event recorded'])],
};

/** A desktop smoke check any agent can opt into (reuses S2). Not in the default suites. */
export function desktopCheck(): QaCheck {
  return check('desktop', 'Desktop smoke', 'p2', desktopSmoke(), ['App window visible']);
}

export function getAgent(category: QaAgentCategory): QaAgentDefinition {
  return QA_AGENTS[category];
}
export function agentChecks(category: QaAgentCategory): QaCheck[] {
  return AGENT_CHECKS[category] ?? [];
}
