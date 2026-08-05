/**
 * Wave 3 capability evidence matrix (honesty ledger). The discipline the program's
 * HONESTY REQUIREMENTS demand, encoded as data:
 *   live-verified    — executed against real data/systems in THIS environment
 *   adapter-verified — validated through reusable interfaces + simulated providers
 *   demo-data        — fictional data for UI/tests, labelled as such
 *   planned          — not implemented in this wave
 * A test asserts the invariant: the natural-language LLM layer is NEVER marked
 * live-verified (no API keys here); the graph/memory/reasoning/timeline ARE, because
 * they run over real persisted NEMS + connectivity data with deterministic logic.
 */
export type EvidenceLevel = 'live-verified' | 'adapter-verified' | 'demo-data' | 'planned';

export interface CapabilityEvidence {
  capability: string;
  module: string;
  level: EvidenceLevel;
  note: string;
}

export const INTELLIGENCE_MATRIX: CapabilityEvidence[] = [
  { capability: 'Knowledge Graph', module: 'M1', level: 'live-verified', note: 'Built over real NEMS entities (orgs/users/OKRs/tasks/dashboards) + connectivity + runtime events, all in real Postgres.' },
  { capability: 'Enterprise Memory', module: 'M2', level: 'live-verified', note: 'Persisted to real Postgres — store/retrieve/summarize/expire/version/audit all execute.' },
  { capability: 'Reasoning Engine', module: 'M3', level: 'live-verified', note: 'Deterministic graph analytics (root-cause/dependency/impact/timeline/risk); every result cites real evidence. No LLM required.' },
  { capability: 'Enterprise Timeline', module: 'M7', level: 'live-verified', note: 'Unified from real runtime audit entries + connectivity sync outcomes + NEMS entities.' },
  { capability: 'Intelligence Services', module: 'M8', level: 'live-verified', note: 'Deterministic risk/trend/pattern/anomaly/dependency/opportunity/recommendation/duplicate over the graph + timeline.' },
  { capability: 'Enterprise Search v2', module: 'M10', level: 'live-verified', note: 'Over the graph + memory + internal NEMS (real DB), returning evidence + relationships + timeline + confidence.' },
  { capability: 'Governance', module: 'M11', level: 'live-verified', note: 'Every AI interaction recorded on the one audit chain + event bus with evidence, confidence, sources, audit id, replay id.' },
  { capability: 'AI Answer generation (deterministic)', module: 'M4/5/6', level: 'live-verified', note: 'The default provider is a deterministic, extractive, evidence-grounded generator — real and tested, cannot fabricate.' },
  { capability: 'AI Answer generation (live LLM)', module: 'M9', level: 'adapter-verified', note: 'Anthropic/OpenAI/Gemini/Ollama/Mistral/Qwen provider adapters implement the one AiProvider interface and are tested against simulated responses. LIVE inference needs operator API keys + network — infra-pending, never fabricated.' },
  { capability: 'Executive Copilots', module: 'M4', level: 'live-verified', note: 'Seven role configs over one engine; assemble real evidence + confidence + audit. Narrative uses the pluggable provider (deterministic by default).' },
  { capability: 'AI Workspace', module: 'M5', level: 'live-verified', note: 'Nine scope configs over one chat engine; every answer links real source evidence.' },
  { capability: 'Executive Briefings', module: 'M6', level: 'live-verified', note: 'Thirteen templates over one engine; assembled from real graph/timeline/reasoning.' },
  { capability: 'SaaS-sourced graph entities (repos/issues/PRs/emails/calendar)', module: 'M1', level: 'adapter-verified', note: 'Populated by Wave 2 SaaS connectors, which are adapter-verified with live sync infra-pending. Demo data in tests.' },
];

export interface IntelligenceReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  demoData: number;
  planned: number;
}

export function intelligenceReadiness(matrix: CapabilityEvidence[] = INTELLIGENCE_MATRIX): IntelligenceReadiness {
  const by = (l: EvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return { total: matrix.length, liveVerified: by('live-verified'), adapterVerified: by('adapter-verified'), demoData: by('demo-data'), planned: by('planned') };
}
