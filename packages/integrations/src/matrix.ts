/**
 * Integration Matrix + Production Readiness Matrix (NCEA 13.0, deliverables 14/15).
 * The honest ledger of what is proven versus pending. Every integration carries an
 * explicit `evidence` level for its ADAPTER and a `live` status for real
 * third-party execution:
 *   verified        — executed here against a real engine (e.g. Postgres, HMAC crypto).
 *   adapter-verified — request construction + response parsing tested without the live service.
 *   infra-pending    — needs credentials / network / a running service; NOT executed.
 * The invariant (enforced by a test) is that nothing claims a live-verified
 * integration it did not actually run — the machine-readable form of "never
 * fabricate successful integrations".
 */
export type Evidence = 'verified' | 'adapter-verified' | 'infra-pending';
export type LiveStatus = 'verified' | 'infra-pending';
export type Category = 'ai-provider' | 'saas' | 'database' | 'storage' | 'protocol';

export interface IntegrationEntry {
  id: string;
  name: string;
  category: Category;
  auth: string;
  capabilities: string[];
  /** Evidence for the adapter (request/parse/logic). */
  evidence: Evidence;
  /** Status of LIVE execution against the real third party. */
  live: LiveStatus;
  notes?: string;
}

const ai = (id: string, name: string, auth: string): IntegrationEntry => ({
  id,
  name,
  category: 'ai-provider',
  auth,
  capabilities: ['generate', 'streaming', 'usage', 'retries', 'timeout', 'health', 'model-discovery'],
  evidence: 'adapter-verified',
  live: 'infra-pending',
});

const saas = (id: string, name: string, auth: string, caps: string[], evidence: Evidence = 'adapter-verified'): IntegrationEntry => ({
  id,
  name,
  category: 'saas',
  auth,
  capabilities: caps,
  evidence,
  live: 'infra-pending',
});

export const INTEGRATION_MATRIX: IntegrationEntry[] = [
  // ── AI providers (Phase 1) — adapters tested; live needs keys ──
  ai('openai', 'OpenAI', 'api-key'),
  ai('anthropic', 'Anthropic', 'api-key-header'),
  ai('google-gemini', 'Google Gemini', 'api-key-header'),
  ai('azure-openai', 'Azure OpenAI', 'api-key-header'),
  { ...ai('ollama', 'Ollama', 'none'), notes: 'local, keyless; live needs a running Ollama' },
  ai('openrouter', 'OpenRouter', 'api-key'),

  // ── SaaS connectors (Phase 2) ──
  saas('github', 'GitHub', 'oauth2', ['list', 'pagination:link', 'webhooks:verified'], 'adapter-verified'),
  saas('slack', 'Slack', 'oauth2', ['list', 'post', 'pagination:cursor', 'webhooks:verified'], 'adapter-verified'),
  saas('stripe', 'Stripe', 'api-key', ['webhooks:verified'], 'adapter-verified'),
  saas('gmail', 'Gmail', 'oauth2', ['oauth', 'refresh', 'incremental-sync']),
  saas('google-calendar', 'Google Calendar', 'oauth2', ['oauth', 'refresh']),
  saas('google-drive', 'Google Drive', 'oauth2', ['oauth', 'refresh']),
  saas('gitlab', 'GitLab', 'oauth2', ['oauth', 'pagination:page']),
  saas('ms-teams', 'Microsoft Teams', 'oauth2', ['oauth', 'refresh']),
  saas('microsoft-365', 'Microsoft 365', 'oauth2', ['oauth', 'refresh']),
  saas('notion', 'Notion', 'oauth2', ['oauth', 'pagination:cursor']),
  saas('jira', 'Jira', 'oauth2', ['oauth', 'refresh', 'pagination:page']),
  saas('confluence', 'Confluence', 'oauth2', ['oauth', 'refresh']),
  saas('linear', 'Linear', 'oauth2', ['oauth']),
  saas('asana', 'Asana', 'oauth2', ['oauth', 'refresh']),
  saas('clickup', 'ClickUp', 'oauth2', ['oauth']),
  saas('salesforce', 'Salesforce', 'oauth2', ['oauth', 'refresh', 'pagination:nextRecordsUrl']),
  saas('hubspot', 'HubSpot', 'oauth2', ['oauth', 'pagination:cursor']),
  saas('shopify', 'Shopify', 'oauth2', ['oauth', 'webhooks']),

  // ── Databases (Phase 3) ──
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    category: 'database',
    auth: 'connection-string',
    capabilities: ['query', 'transactions', 'ping'],
    evidence: 'verified',
    live: 'verified',
    notes: 'executed against a real embedded Postgres engine via the persistence SqlDriver',
  },
  { id: 'mysql', name: 'MySQL', category: 'database', auth: 'connection-string', capabilities: ['query'], evidence: 'adapter-verified', live: 'infra-pending', notes: 'same SqlDriver interface' },
  { id: 'snowflake', name: 'Snowflake', category: 'database', auth: 'connection-string', capabilities: ['query'], evidence: 'adapter-verified', live: 'infra-pending' },
  { id: 'bigquery', name: 'BigQuery', category: 'database', auth: 'service-account', capabilities: ['query'], evidence: 'adapter-verified', live: 'infra-pending' },
  { id: 'mongodb', name: 'MongoDB', category: 'database', auth: 'connection-string', capabilities: ['document'], evidence: 'adapter-verified', live: 'infra-pending' },
  { id: 'redis', name: 'Redis', category: 'database', auth: 'connection-string', capabilities: ['cache'], evidence: 'adapter-verified', live: 'infra-pending' },

  // ── Storage (Phase 3) ──
  { id: 's3', name: 'Amazon S3', category: 'storage', auth: 'aws-sig-v4', capabilities: ['object-url', 'put', 'get'], evidence: 'adapter-verified', live: 'infra-pending' },
  { id: 'azure-blob', name: 'Azure Blob', category: 'storage', auth: 'sas', capabilities: ['object-url'], evidence: 'adapter-verified', live: 'infra-pending' },
  { id: 'gcs', name: 'Google Cloud Storage', category: 'storage', auth: 'service-account', capabilities: ['object-url'], evidence: 'adapter-verified', live: 'infra-pending' },
];

export interface ReadinessSummary {
  total: number;
  verified: number;
  adapterVerified: number;
  liveVerified: number;
  liveInfraPending: number;
}

export function readinessSummary(matrix: IntegrationEntry[] = INTEGRATION_MATRIX): ReadinessSummary {
  return {
    total: matrix.length,
    verified: matrix.filter((e) => e.evidence === 'verified').length,
    adapterVerified: matrix.filter((e) => e.evidence === 'adapter-verified').length,
    liveVerified: matrix.filter((e) => e.live === 'verified').length,
    liveInfraPending: matrix.filter((e) => e.live === 'infra-pending').length,
  };
}

/**
 * The set of integrations whose LIVE execution was genuinely performed here.
 * Anything claiming `live: 'verified'` MUST be in this set — the invariant that
 * makes fabrication detectable by test.
 */
export const LIVE_VERIFIED_IDS = new Set(['postgresql']);
