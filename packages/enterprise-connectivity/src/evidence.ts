/**
 * Launch Workstream 3 capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave 14
 * model). Evidence is NEVER promoted without a real basis:
 *   live-verified          — the in-process control plane: the connector runtime + registry, identity
 *                            federation runtime, data mapping, sync engine, AI routing, AI provider
 *                            registry, workspace context, search engine, integration monitoring, and
 *                            governance.
 *   adapter-verified       — the external enterprise systems + AI providers (Microsoft 365, Google
 *                            Workspace, Slack, Teams, Salesforce, SAP, OpenAI, Anthropic, Gemini, Azure
 *                            OpenAI, Google Drive, OneDrive, and more); represented until configured.
 *   business-data-pending  — customer records, ERP/CRM/email/calendar data, file metadata, and AI
 *                            usage; never imported or fabricated.
 *   infrastructure-pending — enterprise OAuth credentials, customer APIs, production webhooks, and
 *                            enterprise tenant connections; represented until they exist.
 * A test asserts no adapter, business-data, or infrastructure capability is ever classified live — no
 * live OAuth, no successful customer sync, no external AI usage, no customer data.
 */
import type { EcEvidenceLevel } from './types';
import { MATRIX_ADAPTERS, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: EcEvidenceLevel;
  note: string;
}

export const EC_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — the in-process connectivity control plane ──
  { capability: 'Connector Runtime', epic: 'E1', level: 'live-verified', note: 'Lifecycle registry; active only after configure AND verify.' },
  { capability: 'Connector Registry', epic: 'E1', level: 'live-verified', note: 'Reuses the Sprint-3 integration platform connector registry.' },
  { capability: 'Identity Federation Runtime', epic: 'E2', level: 'live-verified', note: 'Real SCIM provisioning via reused security; OAuth stays pending-credentials.' },
  { capability: 'Data Mapping', epic: 'E10', level: 'live-verified', note: 'Real schema/field mapping via the reused transformation engine.' },
  { capability: 'Sync Engine', epic: 'E9', level: 'live-verified', note: 'Real diff via the reused Sprint-3 engine; refused until configured.' },
  { capability: 'AI Routing', epic: 'E8', level: 'live-verified', note: 'Real in-process routing + failover; no external model invoked.' },
  { capability: 'AI Provider Registry', epic: 'E8', level: 'live-verified', note: 'Provider registry + rate limits; external AI usage never fabricated.' },
  { capability: 'Search Engine', epic: 'E12', level: 'live-verified', note: 'Real search over represented metadata; active connectors only.' },
  { capability: 'Workspace Context', epic: 'E11', level: 'live-verified', note: 'Unified context assembled ONLY from active connectors.' },
  { capability: 'Integration Monitoring', epic: 'E13', level: 'live-verified', note: 'Connector/sync/AI dashboards; reuses platform operations.' },
  { capability: 'Governance', epic: 'E14', level: 'live-verified', note: 'Every operation audited on the one ledger with a replay id.' },
  // ── Adapter-verified — external enterprise systems + AI providers, until configured ──
  { capability: 'Microsoft 365', epic: 'E3', level: 'adapter-verified', note: 'Represented; active only with configured credentials + verification.' },
  { capability: 'Google Workspace', epic: 'E3', level: 'adapter-verified', note: 'Represented; active only with configured credentials + verification.' },
  { capability: 'Slack', epic: 'E3', level: 'adapter-verified', note: 'Represented; active only with configured credentials + verification.' },
  { capability: 'Teams', epic: 'E3', level: 'adapter-verified', note: 'Represented; active only with configured credentials + verification.' },
  { capability: 'Salesforce', epic: 'E5', level: 'adapter-verified', note: 'Represented; active only with configured credentials + verification.' },
  { capability: 'SAP', epic: 'E4', level: 'adapter-verified', note: 'Represented; active only with configured credentials + verification.' },
  { capability: 'OpenAI', epic: 'E8', level: 'adapter-verified', note: 'Represented; no external model invoked until configured.' },
  { capability: 'Anthropic', epic: 'E8', level: 'adapter-verified', note: 'Represented; no external model invoked until configured.' },
  { capability: 'Gemini', epic: 'E8', level: 'adapter-verified', note: 'Represented; no external model invoked until configured.' },
  { capability: 'Azure OpenAI', epic: 'E8', level: 'adapter-verified', note: 'Represented; no external model invoked until configured.' },
  { capability: 'Google Drive', epic: 'E6', level: 'adapter-verified', note: 'Represented; active only with configured credentials + verification.' },
  { capability: 'OneDrive', epic: 'E6', level: 'adapter-verified', note: 'Represented; active only with configured credentials + verification.' },
  // ── Business-data-pending — real enterprise data; never imported or fabricated ──
  { capability: 'Customer Records', epic: 'E4', level: 'business-data-pending', note: 'No customer record is read or synced; sample records only.' },
  { capability: 'ERP Data', epic: 'E4', level: 'business-data-pending', note: 'No ERP data is imported or fabricated.' },
  { capability: 'CRM Data', epic: 'E5', level: 'business-data-pending', note: 'No CRM data is imported or fabricated.' },
  { capability: 'Email Data', epic: 'E7', level: 'business-data-pending', note: 'No email body is read; metadata only, and none is fabricated.' },
  { capability: 'Calendar Data', epic: 'E3', level: 'business-data-pending', note: 'No calendar event is read or fabricated.' },
  { capability: 'File Metadata', epic: 'E6', level: 'business-data-pending', note: 'No real file metadata is imported until a connector is verified.' },
  { capability: 'AI Usage', epic: 'E8', level: 'business-data-pending', note: 'No external AI usage is recorded; zero requests until a real call.' },
  // ── Infrastructure-pending — real enterprise credentials/infrastructure ──
  { capability: 'Enterprise OAuth Credentials', epic: 'E2', level: 'infrastructure-pending', note: 'OAuth stays pending-credentials; no live authorization is claimed.' },
  { capability: 'Customer APIs', epic: 'E1', level: 'infrastructure-pending', note: 'No customer API is called; endpoints represented until provided.' },
  { capability: 'Production Webhooks', epic: 'E9', level: 'infrastructure-pending', note: 'No production webhook is registered or received.' },
  { capability: 'Enterprise Tenant Connections', epic: 'E2', level: 'infrastructure-pending', note: 'No real enterprise tenant is connected until configured + verified.' },
];

export interface EcReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function ecReadiness(matrix: CapabilityEvidence[] = EC_MATRIX): EcReadiness {
  const by = (l: EcEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    infrastructurePending: by('infrastructure-pending'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = MATRIX_ADAPTERS.length; // 12
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length; // 4
