/**
 * @neuropause/customer-deployment — NeuroPause Enterprise Management System, Production Execution
 * Program, Sprint 5: Enterprise Customer Deployment & Pilot Operations.
 *
 * An additive package that composes Waves 1-14 and Sprints 1-4, unchanged, into a reusable enterprise
 * customer-deployment platform: customer/tenant/deployment lifecycle, onboarding, configuration,
 * identity federation, integration activation, migration planning, user provisioning, workspace + AI-
 * workforce activation, operational acceptance (reusing Sprint-4 end-to-end validation), UAT,
 * monitoring, hypercare, customer success, rollback, and an evidence-based Go/No-Go readiness gate.
 * Deployment/tenant/monitoring/hypercare runtimes, governance, and documentation are LIVE-VERIFIED;
 * identity providers and ERP/CRM/HR/finance/manufacturing/healthcare/collaboration systems are
 * ADAPTER-VERIFIED until credentials + verification; customer production users/transactions/AI-usage/
 * adoption/KPIs are BUSINESS-DATA-PENDING; and customer production infrastructure/networking/VPNs/
 * certificates/databases are INFRASTRUCTURE-PENDING. No proprietary customer data is imported, no UAT
 * approval is fabricated, and no General Availability is declared. Relife Ortho is a configurable pilot
 * profile (data, not hard-coded logic). Every operation is audited on the one chain with a replay id.
 */
export * from './constants';
export * from './types';
export * from './governance';
export * from './runtime';
export * from './onboarding';
export * from './configuration';
export * from './identityFederation';
export * from './integrationActivation';
export * from './migration';
export * from './provisioning';
export * from './workspaceActivation';
export * from './aiWorkforceActivation';
export * from './acceptance';
export * from './uat';
export * from './monitoring';
export * from './hypercare';
export * from './customerSuccess';
export * from './runbooks';
export * from './pilotProfile';
export * from './rollback';
export * from './readinessGate';
export * from './sdk';
export * from './evidence';
export * from './platform';
