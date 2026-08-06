export * from './types/user';
export * from './types/auth';
export * from './types/app';
export * from './types/store';
export * from './types/runtime';
export * from './types/plugin';
export * from './types/platform';
export * from './types/connectors';
export * from './types/connectorRuntime';
export * from './types/unified';
export * from './types/graph';
export * from './types/erpGraphBridge';
export * from './types/memory';
export * from './types/enterpriseSearch';
export * from './types/enterpriseTimeline';
export * from './types/enterpriseContext';
export * from './types/enterpriseApi';
export * from './types/enterpriseApiManifest';
export * from './types/openapi';
export * from './types/apiAuth';
export * from './types/webhook';
export * from './types/pluginExtension';
export * from './types/observability';
export * from './types/sandbox';
export * from './types/sandboxDesktop';
export * from './types/enterpriseScenario';
export * from './types/aiQaAgent';
export * from './types/perfSecurityLab';
export * from './types/continuousValidation';
export * from './types/cloudOrg';
export * from './types/billing';
export * from './types/sync';
export * from './types/featureFlags';
export * from './types/license';
export * from './types/device';
export * from './types/memorySync';
export * from './types/onboarding';
export * from './types/aiConfig';
export * from './types/feedback';
export * from './types/pilot';
export * from './types/intelligence';
export * from './types/recommendations';
export * from './types/founder';
export * from './types/trace';
export * from './types/worker';
export * from './types/workerPackage';
export * from './types/workforceDelegation';
export * from './types/workforceGovernance';
// A7 — the `workforce:intelligence` response contract, previously declared once in
// the main process and again in the renderer. Canonical here; both sides re-export.
export * from './types/workforceIntelligence';
export * from './types/workforceJobs';
export * from './types/enterpriseIntelligence';
export * from './types/enterprise';
export * from './types/marketplace';
export * from './types/enterpriseModule';
export * from './types/finance';
// Finance → General Ledger (Chart of Accounts + Journal) — pure GL domain rules,
// the module-layer projection of the packages/business ErpCore posting kernel.
export * from './types/generalLedger';
// Finance → W1.6–W1.8: bank reconciliation matching, budget-vs-actual variance,
// and the payable mirror (vendor bills + AP aging) — pure domain rules only.
export * from './types/bankReconciliation';
export * from './types/budgets';
export * from './types/vendorBills';
// Finance → W1.9: fixed-asset register + exact straight-line depreciation.
export * from './types/fixedAssets';
// Finance → W1.10: credit/debit notes — receivable + payable adjustment documents.
export * from './types/adjustmentNotes';
// Finance → W1.11: vendor payments — payable settlement as the source of truth.
export * from './types/vendorPayments';
export * from './types/crm';
export * from './types/leads';
// CRM → W2.1: opportunities — the qualified-deal pipeline between Leads and Quotes.
export * from './types/opportunities';
// CRM → W2.2: activities — the sales activity stream (calls/emails/meetings/tasks/notes).
export * from './types/activities';
// Sales → W2.3: contracts — marker lifecycle, time-derived expiry, renewal chain.
export * from './types/contracts';
// Sales → W2.4: pricing rules — the discount-policy rule book + pure engine.
export * from './types/pricingRules';
// Sales → W2.5: commissions — plan book + immutable bookings-based statements.
export * from './types/commissions';
// Sales → W2.6: revenue forecast — immutable weighted-pipeline snapshots.
export * from './types/revenueForecast';
// CRM → W2.7: customer insights — cross-module health registers + one-account timelines.
export * from './types/customerInsights';
// Procurement → W3.1: RFQs — multi-supplier quotation cycle + deterministic comparison.
export * from './types/rfq';
// Procurement → W3.2: supplier performance — evidence-based scorecard registers.
export * from './types/supplierPerformance';
// Inventory → W3.3: lots — batch traceability with deterministic code payloads.
export * from './types/lots';
// Inventory → W3.4: reservations — hold documents posting real ledger movements.
export * from './types/reservations';
// Inventory → W3.5: valuation — immutable standard-cost registers over the ledger.
export * from './types/inventoryValuation';
// Manufacturing → W3.6: BOM explosion — multi-level requirements with cycle detection.
export * from './types/bomExplosion';
// Projects → W4.1: projects + tasks — delivery containers with a derived-progress task board.
export * from './types/projects';
// Projects → W4.2: time entries + billing runs — unbilled time into real W1 invoices.
export * from './types/projectBilling';
// HR → W4.3/W4.4: employees + payroll runs — work-scoped records and GL-posted accruals.
export * from './types/hr';
// Helpdesk → W5.1: tickets — priority-derived SLA with time-derived breach.
export * from './types/helpdesk';
// CRM → W5.1: campaigns — live lead attribution by the existing campaign field.
export * from './types/marketing';
// Documents → W5.2: registry — append-only check-in versioning over external refs.
export * from './types/documents';
// Executive → W5.2: BI reports — saved aggregations over any registered module.
export * from './types/biReports';
// HR → W6-A1: salary structures — contractual templates + derived statutory wage bases.
export * from './types/salaryStructures';
// HR → W6-A2: statutory rules — effective-dated PF/ESI/PT/TDS tables + pure calculators.
export * from './types/statutoryRules';
// HR → W6-A3: statutory payroll processing — gross-to-net engine + balanced accrual lines.
export * from './types/payrollProcessing';
// HR → W6-A4: salary disbursement — net-pay clearing + deterministic bank advice.
export * from './types/salaryDisbursement';
// HR → W6-A5: payslips — immutable per-employee statements from posted runs.
export * from './types/payslips';
// HR → W6-A6: payroll register — immutable management summary over posted runs.
export * from './types/payrollRegister';
// Inventory → W6-C2: serial units — per-unit serialized tracking.
export * from './types/serials';
// Finance → W6-B1: exchange rates — effective-dated FX table + conversion engine.
export * from './types/exchangeRates';
// Finance → W6-B3: FX gain/loss — realized/unrealized exchange-difference engine.
export * from './types/fxGainLoss';
// Finance → W6-B5: financial ratios — GL-derived class-total ratio engine.
export * from './types/financialRatios';
// HR → W6-A7: statutory filings — ECR/ESI/PT/24Q filing data from posted runs.
export * from './types/statutoryFilings';
export * from './types/customers';
export * from './types/quotes';
export * from './types/orders';
export * from './types/payments';
export * from './types/inventory';
export * from './types/procurement';
export * from './types/warehouse';
export * from './types/manufacturing';
export * from './types/maintenanceManagement';
export * from './types/fulfillment';
export * from './types/planning';
export * from './types/mrp';
export * from './types/timePhasedMrp';
export * from './types/capacityScheduler';
export * from './types/routing';
export * from './types/productionScheduleCommit';
export * from './types/mes';
export * from './types/mesEvents';
export * from './types/mesConsole';
export * from './types/enterpriseRelationship';
export * from './types/trustEngine';
export * from './types/personalization';
export * from './types/uxInfra';
export * from './types/errorReport';
export * from './types/flagCatalog';
export * from './types/releaseChannelMeta';
export * from './types/perfMetrics';
export * from './types/loadingModel';
export * from './types/integrationSdk';
export * from './types/integrationManifest';
export * from './types/integrationCredential';
export * from './types/integrationHealth';
export * from './types/integrationRuntime';
export * from './types/entraGraph';
export * from './types/m365Graph';
export * from './types/manufacturingDigitalTwin';
export * from './types/enterpriseDecisionEngine';
export * from './types/executiveDecisionApproval';
export * from './types/decisionExecutionHandoff';
export * from './types/enterpriseProcessMining';
export * from './types/ecosystem';
export * from './types/ecosystem-exchange';
export * from './types/cloud';
export * from './types/federation';
export * from './types/federationPlatform';
export * from './types/controlPlane';
export * from './types/developerPlatform';
export * from './types/industrySolution';
export * from './types/strategyIntelligence';
export * from './types/enterpriseTwin';
export * from './types/enterpriseKnowledge';
export * from './types/globalOrchestration';
export * from './types/enterpriseIntelligenceNetwork';
export * from './types/autonomousOperations';
export * from './types/commercialPlatform';
export * from './types/experience';
export * from './types/intent';
export * from './types/update';
export * from './types/diagnostics';
export * from './types/maintenance';
export * from './ipc/channels';
export * from './ipc/contracts';
// A7 — the response half of the IPC contract (channel -> resolved shape). Types
// only; nothing here is emitted to JavaScript.
export * from './ipc/responses';
// A7 — the push half (channel -> broadcast payload). Types, plus the one value
// `BROADCAST_CHANNELS`, which lets a test compare the map against the preload's
// subscribe allowlist; see the note on it.
export * from './ipc/broadcasts';
export * from './types/aiEngine';
// Phase 6 Stage 4 — Workspace Assistant.
export * from './types/assistant';
// Phase 6 Stage 5 — Notification Inbox.
export * from './types/notifications';
// Phase 6 Stage 6 — Enterprise Intelligence Layer (signal registry / health framework /
// predictions / dependency graph / confidence breakdown / outcome lifecycle).
export * from './types/insight';
// Phase 6 Stage 7 — Enterprise Knowledge & Decision Platform (asset inventory /
// authority precedence / relationship matrix + impact / decision lineage /
// lifecycle derivation / quality / standards / coverage map / dashboard).
export * from './types/knowledgeAssets';
// Phase 6 Stage 8 — Enterprise Automation Platform (catalog / playbooks compiled
// to the existing WorkflowSpec / policy resolution / approval preview / honest
// rollback / schedule parsing / execution monitor / dashboard).
export * from './types/automationPlatform';
export * from './types/operationsPlatform';
// Phase 6 Stage 10 — Enterprise Strategy Platform (objectives / initiative
// portfolio / business value / planning / the Enterprise Capability Map /
// strategy health / dashboard / board report — all computed views).
export * from './types/strategyPlatform';
// Phase 6 Stage 11 — Enterprise Federation Platform (partners / trust evidence /
// organization exchange × local records / shared S7–S10 layers / dashboard /
// federation report — all computed views over the EXISTING federation stores).
export * from './types/enterpriseFederation';
// Phase 6 Stage 12 — Enterprise Analytics Platform (unified KPI catalog /
// recorded-window trends / forecast-capability inventory / decision
// intelligence / executive analytics dashboard + report — pure COMPOSITION
// over the existing producers; no analytics computed here).
export * from './types/enterpriseAnalytics';
// Phase 6 Stage 13 — Enterprise Digital Twin Platform (runtime/execution twin /
// Stage 6–12 platform twins / enterprise state-coverage map / simulation
// inventory / recorded-history view / platform dashboard + report — the
// additive COMPOSITION layer over the P15 Enterprise Digital Twin, which stays
// authoritative and untouched). Every exported name carries the `Etwin` prefix
// so nothing collides with P15's `Twin*` or the manufacturing twin's `Twin*`.
export * from './types/enterpriseTwinPlatform';
export * from './types/delivery';
export * from './types/orgHealth';
export * from './types/executiveCenter';
export * from './types/systemHealth';
export * from './types/runtimeSupervisor';
export * from './types/executeEngine';
export * from './types/automation';
export * from './automationEngine';
export * from './types/voice';
export * from './voiceSession';
export * from './voiceCommands';
export * from './types/interaction';
export * from './interactionRouter';
// P6 — Cloud & Infrastructure Control Plane (pure model; the runtime + Center consume these).
export * from './infra/cloudPlatform';
export * from './infra/resourceGraph';
export * from './infra/discovery';
export * from './infra/resourceGraphBridge';
export * from './infra/action';
// P7 — Enterprise Intelligence (pure engines composed over the existing graphs/timeline; the runtime consumes these).
export * from './intelligence/enterpriseGraph';
export * from './intelligence/enterpriseHealth';
export * from './intelligence/enterpriseDrift';
export * from './intelligence/enterpriseCapacity';
export * from './intelligence/enterpriseRootCause';
export * from './intelligence/enterpriseRecommendation';
export * from './intelligence/enterpriseIntelligence';
