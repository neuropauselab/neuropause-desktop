/**
 * Module 20 — Enterprise APIs / composition root. `createBusinessPlatform(runtime, …)` assembles
 * the Wave 8 enterprise business layer on the EXISTING platform: it reuses the one runtime audit
 * chain + event bus (business governance), the Wave 4 HITL gate (business approvals), the Wave 6
 * GlobalSearch (business AI), and — when provided — the Wave 5 execution platform (reused
 * connector count). No service is duplicated. Exposes the runtime.* API surface plus accessors,
 * the evidence matrix, and readiness.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { HumanInTheLoopGate } from '@neuropause/automation';
import type { ExecutionPlatform } from '@neuropause/execution';
import { BUSINESS_VERSION } from './constants';
import { BUSINESS_MATRIX, businessReadiness, type CapabilityEvidence, type BusinessReadiness } from './evidence';
import { BusinessGovernance } from './governance';
import { AdapterRegistry } from './adapters';
import { CrmRuntime } from './crm';
import { SalesRuntime } from './sales';
import { CustomerSuccessRuntime } from './customerSuccess';
import { ErpCore } from './erp';
import { AccountingRuntime } from './accounting';
import { PayrollRuntime } from './payroll';
import { BankingRuntime } from './banking';
import { TaxRuntime } from './tax';
import { ProcurementRuntime } from './procurement';
import { InventoryRuntime } from './inventory';
import { ManufacturingRuntime } from './manufacturing';
import { HealthcareRuntime } from './healthcare';
import { HrRuntime } from './hr';
import { ProjectRuntime } from './projects';
import { AssetRuntime } from './assets';
import { ComplianceRuntime } from './compliance';
import { BusinessIntelligence } from './intelligence';
import { BusinessAutomation } from './automation';
import { BusinessAnalytics } from './analytics';
import { ExecutiveDashboards } from './executive';

export interface BusinessPlatformOptions {
  clock?: Clock;
  execution?: ExecutionPlatform;
}

export interface BusinessPlatform {
  version: string;
  // runtime.* enterprise APIs (Module 20)
  crm(): CrmRuntime;
  sales(): SalesRuntime;
  customerSuccess(): CustomerSuccessRuntime;
  erp(): ErpCore;
  finance(): ErpCore;
  accounting(): AccountingRuntime;
  payroll(): PayrollRuntime;
  banking(): BankingRuntime;
  tax(): TaxRuntime;
  procurement(): ProcurementRuntime;
  inventory(): InventoryRuntime;
  manufacturing(): ManufacturingRuntime;
  healthcare(): HealthcareRuntime;
  hr(): HrRuntime;
  projects(): ProjectRuntime;
  assets(): AssetRuntime;
  compliance(): ComplianceRuntime;
  analytics(): BusinessAnalytics;
  executive(): ExecutiveDashboards;
  // integration + accessors
  adapters(): AdapterRegistry;
  intelligence(): BusinessIntelligence;
  automation(): BusinessAutomation;
  governance(): BusinessGovernance;
  reusedConnectorCount(): number;
  matrix(): CapabilityEvidence[];
  readiness(): BusinessReadiness;
}

export function createBusinessPlatform(runtime: EnterpriseRuntime, options: BusinessPlatformOptions = {}): BusinessPlatform {
  const clock = options.clock ?? systemClock;
  const governance = new BusinessGovernance(runtime, clock);
  const hitl = new HumanInTheLoopGate();

  const adapters = new AdapterRegistry(governance);
  const crm = new CrmRuntime(clock, governance);
  const sales = new SalesRuntime(clock, governance, crm);
  const customerSuccess = new CustomerSuccessRuntime(clock, governance, crm);
  const erp = new ErpCore(clock, governance);
  const accounting = new AccountingRuntime(clock, governance, erp);
  const payroll = new PayrollRuntime(clock, governance);
  const banking = new BankingRuntime(clock, governance);
  const tax = new TaxRuntime(clock, governance);
  const procurement = new ProcurementRuntime(clock, governance);
  const inventory = new InventoryRuntime(clock, governance);
  const manufacturing = new ManufacturingRuntime(clock, governance);
  const healthcare = new HealthcareRuntime(clock, governance);
  const hr = new HrRuntime(clock, governance);
  const projects = new ProjectRuntime(clock, governance);
  const assets = new AssetRuntime(clock, governance);
  const compliance = new ComplianceRuntime(clock, governance);

  const automation = new BusinessAutomation(governance, hitl);
  const intelligence = new BusinessIntelligence({ crm, hr, procurement, projects, assets });
  const analytics = new BusinessAnalytics({ crm, sales, accounting, hr, procurement, projects, assets, ...(options.execution ? { execution: options.execution } : {}) });
  const executive = new ExecutiveDashboards({ crm, sales, accounting, hr, procurement, projects, assets, compliance });

  return {
    version: BUSINESS_VERSION,
    crm: () => crm,
    sales: () => sales,
    customerSuccess: () => customerSuccess,
    erp: () => erp,
    finance: () => erp,
    accounting: () => accounting,
    payroll: () => payroll,
    banking: () => banking,
    tax: () => tax,
    procurement: () => procurement,
    inventory: () => inventory,
    manufacturing: () => manufacturing,
    healthcare: () => healthcare,
    hr: () => hr,
    projects: () => projects,
    assets: () => assets,
    compliance: () => compliance,
    analytics: () => analytics,
    executive: () => executive,
    adapters: () => adapters,
    intelligence: () => intelligence,
    automation: () => automation,
    governance: () => governance,
    reusedConnectorCount: () => options.execution?.connectors().count() ?? 0,
    matrix: () => BUSINESS_MATRIX,
    readiness: () => businessReadiness(),
  };
}
