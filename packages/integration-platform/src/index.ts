/**
 * @neuropause/integration-platform — NeuroPause Enterprise Management System, Production Execution
 * Program, Sprint 3: the Universal Enterprise Integration Platform. Composes Waves 1–14 and
 * Sprints 1–2, unchanged, into a governed, evidence-first integration layer with reusable adapter
 * frameworks. Named integration-platform because packages/integrations already exists as a base
 * package (composed additively; not modified).
 *
 * HONESTY BOUNDARY (see INTEGRATION_MATRIX) — evidence is never promoted without configuration + verification:
 *   live-verified          — integration/connector/gateway/transformation/synchronization/messaging/
 *                            security/monitoring runtimes, governance, documentation.
 *   adapter-verified       — SAP/Oracle/Dynamics/NetSuite/Salesforce/HubSpot/M365/Google Workspace/
 *                            Slack/Teams/Stripe/Epic/Oracle Health/Kafka/RabbitMQ/OpenAI/Anthropic/Gemini.
 *   business-data-pending  — customer/ERP/CRM/manufacturing/healthcare/finance/HR data.
 *   infrastructure-pending — customer APIs/credentials/VPN/message-brokers/databases.
 */
export * from './constants';
export * from './types';
export * from './governance';
export * from './runtime';
export * from './gateway';
export * from './sync';
export * from './transformation';
export * from './messaging';
export * from './frameworks';
export * from './identityIntegration';
export * from './ai';
export * from './integrationSecurity';
export * from './monitoring';
export * from './documentation';
export * from './evidence';
export * from './platform';
