/**
 * AI Sandbox — AI QA Agent (S4): scenario templates.
 *
 * Deterministic builders that produce S3 enterprise (and S2 desktop) scenario SPECS the
 * agents submit to the executors. These reuse the exact S3 action/assertion vocabulary —
 * the agent generates a spec, it does not perform any operation. Pure functions; the S3
 * parser fills every default, so the specs stay minimal.
 */
import type { ScenarioSpec } from '@neuropause/shared';

/** CRM smoke: create a customer, update it, assert it exists and updated. */
export function crmSmoke(): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'crm', metadata: { title: 'CRM smoke — customer lifecycle' },
    steps: [
      { id: 'create', action: 'createCustomer', input: { name: 'QA Customer', status: 'active', customerTier: 'standard' }, saveAs: 'custId', assert: [{ type: 'recordExists', moduleId: 'crm-customers', target: '${custId}' }] },
      { id: 'update', action: 'updateCustomer', input: { id: '${custId}', status: 'active', creditLimit: 5000 }, dependsOn: ['create'], assert: [{ type: 'recordUpdated', moduleId: 'crm-customers', target: '${custId}', field: 'status', expected: 'active' }] },
    ],
    assertions: [{ type: 'timelineEventExists', target: '${custId}' }, { type: 'knowledgeGraphUpdated', target: '${custId}' }],
  };
}

/** Procure-to-pay: customer → PO → approve → assert lifecycle + KPI. */
export function procureToPay(): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'procurement', metadata: { title: 'Procure to Pay' },
    preconditions: [{ type: 'moduleRegistered', target: 'procurement-orders' }, { type: 'permission', permission: 'sandbox:manage' }],
    steps: [
      { id: 'cust', action: 'createCustomer', input: { name: 'P2P Co', status: 'active' }, saveAs: 'custId' },
      { id: 'po', action: 'createPurchaseOrder', input: { poNumber: 'QA-PO-1', customer: '${custId}', total: 1000 }, saveAs: 'poId', dependsOn: ['cust'] },
      { id: 'approve', action: 'approvePurchaseOrder', input: { id: '${poId}' }, dependsOn: ['po'], assert: [{ type: 'recordUpdated', moduleId: 'procurement-orders', target: '${poId}', field: 'status', expected: 'approved' }] },
    ],
    assertions: [{ type: 'executiveKpiChanged', target: 'records' }],
  };
}

/** Manufacturing: create a production order and drive it through plan → complete. */
export function manufacturingFlow(): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'manufacturing', metadata: { title: 'Manufacturing production order' },
    steps: [
      { id: 'po', action: 'createProductionOrder', input: { orderNumber: 'QA-MO-1', bom: 'BOM-1', warehouse: 'WH-1', productionQuantity: 10 }, saveAs: 'moId' },
      { id: 'plan', action: 'scheduleProduction', input: { id: '${moId}', action: 'plan' }, dependsOn: ['po'], assert: [{ type: 'recordUpdated', moduleId: 'manufacturing-orders', target: '${moId}', field: 'status', expected: 'planned' }] },
    ],
    assertions: [],
  };
}

/** Inventory: create a product and issue stock. */
export function inventoryFlow(): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'inventory', metadata: { title: 'Inventory product + issue' },
    steps: [
      { id: 'prod', action: 'createProduct', input: { sku: 'QA-SKU-1', name: 'QA Widget' }, saveAs: 'prodId', assert: [{ type: 'recordExists', moduleId: 'inventory-products', target: '${prodId}' }] },
      { id: 'issue', action: 'issueInventory', input: { movementNumber: 'QA-MV-1', product: '${prodId}', warehouse: 'WH-1', quantity: 5 }, dependsOn: ['prod'] },
    ],
    assertions: [],
  };
}

/** Planning: run MRP + APS and assert they returned a summary. */
export function planningCheck(): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'planning', metadata: { title: 'Planning MRP + APS' },
    steps: [
      { id: 'mrp', action: 'runMrp', saveAs: 'mrp' },
      { id: 'aps', action: 'runAps', saveAs: 'aps' },
    ],
    assertions: [],
  };
}

/** Finance: sales order → invoice → payment. */
export function financeFlow(): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'finance', metadata: { title: 'Order to cash' },
    steps: [
      { id: 'so', action: 'createSalesOrder', input: { orderNumber: 'QA-SO-1', customer: 'QA Co', status: 'pending' }, saveAs: 'soId' },
      { id: 'inv', action: 'createInvoice', input: { number: 'QA-INV-1', customer: 'QA Co', amount: 500, currency: 'USD' }, saveAs: 'invId', dependsOn: ['so'], assert: [{ type: 'recordExists', moduleId: 'finance', target: '${invId}' }] },
      { id: 'pay', action: 'receivePayment', input: { paymentNumber: 'QA-PAY-1', invoiceRef: '${invId}', amount: 500, currency: 'USD' }, dependsOn: ['inv'] },
    ],
    assertions: [],
  };
}

/** Security: assert a permission is granted and another is denied (RBAC enforced by executors). */
export function securityRbac(grantedPermission: string, deniedPermission: string): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'security', metadata: { title: 'RBAC enforcement' },
    steps: [{ id: 'probe', action: 'wait', input: { durationMs: 0 }, assert: [
      { type: 'securityPermission', permission: grantedPermission, allowed: true },
      { type: 'rbacValidation', permission: deniedPermission, allowed: false },
    ] }],
    assertions: [],
  };
}

/** Developer channels: SDK + CLI + REST smoke. */
export function developerChannels(): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'developer', metadata: { title: 'Developer channels (SDK/CLI/REST)' },
    steps: [
      { id: 'sdk', action: 'executeSdkCall', input: { method: 'getModules' }, saveAs: 'mods', assert: [{ type: 'sdkResult', target: 'mods', field: 'ok', expected: true }] },
      { id: 'cli', action: 'executeCliCommand', input: { argv: ['health'] }, saveAs: 'cli', assert: [{ type: 'cliResult', target: 'cli', field: 'code', expected: 0 }] },
      { id: 'rest', action: 'executeRestCall', input: { method: 'GET', path: '/health' }, saveAs: 'rest', assert: [{ type: 'restResponse', target: 'rest', field: 'status', expected: 200 }] },
    ],
    assertions: [],
  };
}

/** Plugin registry check. */
export function pluginCheck(pluginId: string): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'plugins', metadata: { title: `Plugin registered — ${pluginId}` },
    steps: [{ id: 'probe', action: 'wait', input: { durationMs: 0 }, assert: [{ type: 'pluginRegistered', target: pluginId }] }],
    assertions: [],
  };
}

/** Connector sync check. */
export function connectorCheck(connectorId: string): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'connectors', metadata: { title: `Connector sync — ${connectorId}` },
    steps: [{ id: 'sync', action: 'syncConnector', input: { connectorId }, assert: [{ type: 'connectorSynced', target: connectorId }] }],
    assertions: [],
  };
}

/** Automation trigger check. */
export function automationCheck(ruleId: string): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'automation', metadata: { title: `Automation — ${ruleId}` },
    steps: [{ id: 'run', action: 'triggerAutomation', input: { ruleId }, assert: [{ type: 'automationExecuted', expected: 1 }] }],
    assertions: [],
  };
}

/** Executive KPI check. */
export function executiveCheck(): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'executive', metadata: { title: 'Executive KPI reacts to a change' },
    steps: [{ id: 'create', action: 'createCustomer', input: { name: 'Exec KPI Co', status: 'active' }, saveAs: 'id' }],
    assertions: [{ type: 'executiveKpiChanged', target: 'records' }],
  };
}

/** Knowledge-graph check: a created record surfaces as a graph node. */
export function knowledgeGraphCheck(): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'knowledge-graph', metadata: { title: 'Knowledge graph node created' },
    steps: [{ id: 'create', action: 'createCustomer', input: { name: 'KG Co', status: 'active' }, saveAs: 'id', assert: [{ type: 'knowledgeGraphUpdated', target: '${id}' }] }],
    assertions: [],
  };
}

/** Timeline check: a created record surfaces a timeline event. */
export function timelineCheck(): ScenarioSpec {
  return {
    kind: 'enterprise', category: 'timeline', metadata: { title: 'Timeline event recorded' },
    steps: [{ id: 'create', action: 'createCustomer', input: { name: 'Timeline Co', status: 'active' }, saveAs: 'id', assert: [{ type: 'timelineEventExists', target: '${id}' }] }],
    assertions: [],
  };
}

/** A desktop smoke scenario (S2), for agents that include a UI check. */
export function desktopSmoke(): ScenarioSpec {
  return {
    kind: 'desktop', launch: { profile: 'temporary' },
    actions: [
      { type: 'waitFor', selector: '#app' },
      { type: 'screenshot', name: 'home' },
      { type: 'assertVisible', selector: '#app' },
    ],
  };
}
