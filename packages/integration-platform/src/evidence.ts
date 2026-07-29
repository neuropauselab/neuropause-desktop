/**
 * Sprint 3 capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave 14 model).
 * Evidence is NEVER promoted without configuration and verification:
 *   live-verified          — the in-process runtimes that really execute: integration runtime,
 *                            connector runtime, API gateway, transformation engine, synchronization
 *                            engine, messaging runtime, integration security, monitoring runtime,
 *                            governance, and documentation.
 *   adapter-verified       — external systems (SAP/Oracle/Dynamics/NetSuite/Salesforce/HubSpot/
 *                            Microsoft 365/Google Workspace/Slack/Teams/Stripe/Epic/Oracle Health/
 *                            Kafka/RabbitMQ/OpenAI/Anthropic/Gemini); represented until configured.
 *   business-data-pending  — customer records, ERP/CRM/manufacturing/healthcare/finance/HR data;
 *                            never imported or fabricated.
 *   infrastructure-pending — customer APIs, customer credentials, VPN/private networks, customer
 *                            message brokers, and customer databases; represented until provided.
 * A test asserts no adapter, business-data, or infrastructure capability is ever classified live.
 */
import type { IntegrationEvidenceLevel } from './types';
import { MATRIX_ADAPTERS, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: IntegrationEvidenceLevel;
  note: string;
}

const adapterRows: CapabilityEvidence[] = MATRIX_ADAPTERS.map((system) => ({
  capability: system,
  epic: 'E4-E14',
  level: 'adapter-verified' as const,
  note: `${system} represented — adapter-verified until configured and a real connection is verified.`,
}));

export const INTEGRATION_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — in-process runtimes that really execute ──
  { capability: 'Integration Runtime', epic: 'E1', level: 'live-verified', note: 'Registries + lifecycle; active only after configure AND verify.' },
  { capability: 'Connector Runtime', epic: 'E1', level: 'live-verified', note: 'REUSES the base connectors platform registry; adapters catalogued, none contacted.' },
  { capability: 'API Gateway', epic: 'E2', level: 'live-verified', note: 'Real fixed-window rate limiting + required-field validation across 7 protocols.' },
  { capability: 'Transformation Engine', epic: 'E16', level: 'live-verified', note: 'Real JSON↔CSV, field mapping, and schema validation.' },
  { capability: 'Synchronization Engine', epic: 'E15', level: 'live-verified', note: 'Real diff: added/updated/unchanged/conflict; retry queue + DLQ.' },
  { capability: 'Messaging Runtime', epic: 'E9', level: 'live-verified', note: 'Real in-process publish/consume/retry/DLQ/replay; brokers adapter-verified.' },
  { capability: 'Integration Security', epic: 'E17', level: 'live-verified', note: 'REUSES security token issue/verify; secret references only, never values.' },
  { capability: 'Monitoring Runtime', epic: 'E18', level: 'live-verified', note: 'Connector/sync/API health from real state; REUSES operations health.' },
  { capability: 'Governance', epic: 'E19', level: 'live-verified', note: 'Records org/integration/connector/operator/evidence/approval/replay id/timestamp.' },
  { capability: 'Documentation', epic: 'E20', level: 'live-verified', note: 'Nine guide outlines; REUSES the production documentation generator.' },
  // ── Adapter-verified — external systems, until configured ──
  ...adapterRows,
  // ── Business-data-pending — customer data; never imported or fabricated ──
  { capability: 'Customer Records', epic: 'E1', level: 'business-data-pending', note: 'Empty until a real, verified connection imports them (later sprints).' },
  { capability: 'ERP Data', epic: 'E4', level: 'business-data-pending', note: 'No ERP record is read or synced here.' },
  { capability: 'CRM Data', epic: 'E5', level: 'business-data-pending', note: 'No CRM record is read or synced here.' },
  { capability: 'Manufacturing Data', epic: 'E12', level: 'business-data-pending', note: 'No industrial telemetry is read; no equipment operated.' },
  { capability: 'Healthcare Data', epic: 'E13', level: 'business-data-pending', note: 'No patient record is read or fabricated; no live medical access.' },
  { capability: 'Finance Data', epic: 'E11', level: 'business-data-pending', note: 'No payment processed; no ledger imported.' },
  { capability: 'HR Data', epic: 'E10', level: 'business-data-pending', note: 'No employee record is read or synced here.' },
  // ── Infrastructure-pending — the customer's own infrastructure; represented until provided ──
  { capability: 'Customer APIs not configured', epic: 'E2', level: 'infrastructure-pending', note: 'Endpoints represented; no customer API is called.' },
  { capability: 'Customer credentials not provided', epic: 'E17', level: 'infrastructure-pending', note: 'Only references; no credential is stored or used.' },
  { capability: 'VPN / private network connections', epic: 'E1', level: 'infrastructure-pending', note: 'Represented; no private network is established.' },
  { capability: 'Customer message brokers', epic: 'E9', level: 'infrastructure-pending', note: 'Brokers represented; no external broker is connected.' },
  { capability: 'Customer databases', epic: 'E8', level: 'infrastructure-pending', note: 'Databases represented; no external database is connected.' },
];

export interface IntegrationReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function integrationReadiness(matrix: CapabilityEvidence[] = INTEGRATION_MATRIX): IntegrationReadiness {
  const by = (l: IntegrationEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    infrastructurePending: by('infrastructure-pending'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = MATRIX_ADAPTERS.length;
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length;
