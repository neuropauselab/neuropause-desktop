/**
 * Wave 5 capability evidence matrix (honesty ledger). Per the HONESTY RULE:
 *   live-verified    — a REAL execution occurred in this environment (in-process, or over
 *                      real HTTP against a local server — a real socket + round-trip)
 *   adapter-verified — request construction + response mapping proven against SIMULATED
 *                      provider responses through the transport seam
 *   infra-pending    — live execution against a real external SaaS needs operator OAuth +
 *                      network; NOT claimed to have occurred
 * A test asserts: the execution pipeline is live-verified (real HTTP happened); no SaaS
 * connector is marked live-verified (no real GitHub/Slack/… call occurred).
 */
import type { EvidenceLevel } from './types';

export interface CapabilityEvidence {
  capability: string;
  module: string;
  level: EvidenceLevel;
  note: string;
}

export const EXECUTION_MATRIX: CapabilityEvidence[] = [
  { capability: 'Connector Execution Engine (pipeline over REAL HTTP)', module: 'M2', level: 'live-verified', note: 'The full pipeline (policy → HITL → rate limit → circuit breaker → retry/timeout → transport → observe → govern) executes over real HTTP against a local server — a real execution occurs.' },
  { capability: 'Universal Connector Runtime', module: 'M1', level: 'live-verified', note: '22 connector descriptors registered; generic REST/GraphQL/Webhooks execute live.' },
  { capability: 'OAuth Lifecycle Manager', module: 'M3', level: 'live-verified', note: 'Authorize-URL/exchange/refresh construction + a token refresh executed over real HTTP against a local token server.' },
  { capability: 'Secret Rotation Platform', module: 'M4', level: 'live-verified', note: 'Scheduled/triggered rotation over the real encrypted vault; versions + rotation timestamps recorded.' },
  { capability: 'Credential Vault Extensions', module: 'M5', level: 'live-verified', note: 'Envelope-encrypted (AES-256-GCM) storage with expiry + kind + rotation metadata; ciphertext never plaintext.' },
  { capability: 'Connector Health Monitoring', module: 'M6', level: 'live-verified', note: 'Active health probes execute over real HTTP; healthy/degraded/down states derived from real results.' },
  { capability: 'Retry & Recovery Engine (+ DLQ)', module: 'M7', level: 'live-verified', note: 'Real 5xx retried with backoff over real HTTP; exhausted executions dead-lettered and recoverable.' },
  { capability: 'Rate Limiter', module: 'M8', level: 'live-verified', note: 'Per-tenant/connector token bucket blocks real over-limit executions.' },
  { capability: 'Webhook Runtime', module: 'M9', level: 'live-verified', note: 'Real HMAC signature verification (github/slack/stripe), dedup, DLQ, replay.' },
  { capability: 'Event Streaming Platform', module: 'M10', level: 'live-verified', note: 'Subscriptions + partitions + replay over the one runtime event bus.' },
  { capability: 'Universal API Gateway', module: 'M11', level: 'live-verified', note: 'Unified request/response contract routing to the engine — exercised over real HTTP.' },
  { capability: 'Connector Observability', module: 'M12', level: 'live-verified', note: 'Latency/error-rate/throughput metrics per connector from real executions.' },
  { capability: 'Enterprise Policy Enforcement', module: 'M13', level: 'live-verified', note: 'Allow/deny/require-approval policies enforced before every execution; deny blocks and is governed.' },
  { capability: 'External Execution Governance', module: 'M14', level: 'live-verified', note: 'Every execution recorded on the one audit chain + event bus with evidence, audit id, replay id — replayable.' },
  { capability: 'Connector Analytics', module: 'M15', level: 'live-verified', note: 'Success/error rate, latency percentiles, throughput over real execution history.' },
  { capability: 'Production Dashboards', module: 'M16', level: 'live-verified', note: 'Execution/health/policy/queue dashboards from live state.' },
  { capability: 'SaaS connector execution (GitHub/Slack/Salesforce/… ×19)', module: 'M1', level: 'adapter-verified', note: 'Request construction + response mapping verified against simulated responses. LIVE execution needs operator OAuth + network — infra-pending, never claimed to have occurred.' },
];

export interface ExecutionReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  infraPending: number;
}

export function executionReadiness(matrix: CapabilityEvidence[] = EXECUTION_MATRIX): ExecutionReadiness {
  const by = (l: EvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return { total: matrix.length, liveVerified: by('live-verified'), adapterVerified: by('adapter-verified'), infraPending: by('infra-pending') };
}
