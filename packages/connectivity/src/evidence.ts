/**
 * Wave 2 connector evidence matrix (honesty ledger). Reuses the integrations
 * `Evidence` discipline: `adapter-verified` = the adapter's request-construction and
 * response-mapping are proven against simulated provider responses through the HTTP
 * transport seam; `verified` = genuinely executed end-to-end against a real system;
 * `infra-pending` = live third-party execution needs operator OAuth credentials +
 * network and is NOT claimed here. Only PostgreSQL is live-verified (real embedded
 * Postgres); every SaaS connector is adapter-verified + live infra-pending. A test
 * enforces that no entry claims `live: 'verified'` unless it is in
 * LIVE_VERIFIED_CONNECTORS — so live status can never be fabricated.
 */
import type { Evidence } from '@neuropause/integrations';
import type { ConnectorId } from './constants';

export type LiveStatus = 'verified' | 'infra-pending';

export interface ConnectorEvidence {
  id: ConnectorId;
  name: string;
  category: 'saas' | 'database';
  auth: string;
  resources: string[];
  /** Adapter proof level against the transport seam. */
  evidence: Evidence;
  /** Real third-party execution status. */
  live: LiveStatus;
  notes: string;
}

/** The ONLY connectors permitted to claim live: 'verified'. Enforced by a test. */
export const LIVE_VERIFIED_CONNECTORS = new Set<ConnectorId>(['postgresql']);

export const CONNECTIVITY_MATRIX: ConnectorEvidence[] = [
  {
    id: 'github', name: 'GitHub', category: 'saas', auth: 'oauth2 / pat',
    resources: ['repositories', 'pull_requests', 'issues', 'commits', 'branches', 'tags', 'releases', 'workflow_runs', 'workflows', 'members'],
    evidence: 'adapter-verified', live: 'infra-pending',
    notes: 'REST request-construction + mapping verified via simulated responses. Discussions/Projects are GraphQL-only extensions. Live calls need a GitHub OAuth app or PAT.',
  },
  {
    id: 'gmail', name: 'Gmail', category: 'saas', auth: 'oauth2',
    resources: ['messages', 'threads', 'labels', 'drafts', 'attachments'],
    evidence: 'adapter-verified', live: 'infra-pending',
    notes: 'Gmail REST v1 adapter verified against simulated responses. Live calls need a Google OAuth app + consent.',
  },
  {
    id: 'google-calendar', name: 'Google Calendar', category: 'saas', auth: 'oauth2',
    resources: ['calendars', 'events', 'availability', 'invitations'],
    evidence: 'adapter-verified', live: 'infra-pending',
    notes: 'Calendar v3 adapter verified against simulated responses. Live calls need a Google OAuth app + consent.',
  },
  {
    id: 'slack', name: 'Slack', category: 'saas', auth: 'oauth2',
    resources: ['channels', 'messages', 'threads', 'mentions', 'files', 'reactions'],
    evidence: 'adapter-verified', live: 'infra-pending',
    notes: 'Web API adapter verified against simulated responses. Live calls need a Slack app token.',
  },
  {
    id: 'jira', name: 'Jira', category: 'saas', auth: 'oauth2 / basic',
    resources: ['projects', 'issues', 'epics', 'sprints', 'boards', 'comments'],
    evidence: 'adapter-verified', live: 'infra-pending',
    notes: 'Jira Cloud REST v3 + Agile adapter verified against simulated responses. Live calls need an Atlassian OAuth app or API token.',
  },
  {
    id: 'notion', name: 'Notion', category: 'saas', auth: 'oauth2',
    resources: ['pages', 'databases', 'blocks', 'search'],
    evidence: 'adapter-verified', live: 'infra-pending',
    notes: 'Notion API adapter verified against simulated responses. Live calls need a Notion integration token.',
  },
  {
    id: 'postgresql', name: 'PostgreSQL', category: 'database', auth: 'connection-string',
    resources: ['schema_discovery', 'read_only_query', 'analytics', 'synchronization'],
    evidence: 'verified', live: 'verified',
    notes: 'Executed end-to-end against real embedded Postgres (PGlite) via the persistence SqlDriver — read-only queries, schema discovery, and checkpointed sync all genuinely run.',
  },
];

export interface ConnectivityReadiness {
  total: number;
  adapterVerified: number;
  liveVerified: number;
  liveInfraPending: number;
}

export function connectivityReadiness(matrix: ConnectorEvidence[] = CONNECTIVITY_MATRIX): ConnectivityReadiness {
  return {
    total: matrix.length,
    adapterVerified: matrix.filter((m) => m.evidence === 'adapter-verified' || m.evidence === 'verified').length,
    liveVerified: matrix.filter((m) => m.live === 'verified').length,
    liveInfraPending: matrix.filter((m) => m.live === 'infra-pending').length,
  };
}
