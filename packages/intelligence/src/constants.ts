/**
 * Wave 3 constants — the parameter spaces for the role/scope/template-driven engines.
 * Isolated module (no imports).
 */
export const INTELLIGENCE_VERSION = '0.0.0-preview.1';

/** Module 4 / 13 — the seven executive roles (one engine, seven configs). */
export const EXECUTIVE_ROLES = ['CEO', 'CTO', 'CPO', 'CRO', 'CMO', 'CFO', 'COO'] as const;
export type ExecutiveRole = (typeof EXECUTIVE_ROLES)[number];

/** Module 5 — the nine AI-workspace chat scopes (one engine, nine configs). */
export const CHAT_SCOPES = ['universal', 'repository', 'document', 'meeting', 'email', 'calendar', 'project', 'customer', 'cross-system'] as const;
export type ChatScope = (typeof CHAT_SCOPES)[number];

/** Module 6 — the thirteen briefing templates (one engine, thirteen templates). */
export const BRIEFING_TYPES = [
  'morning', 'evening', 'daily-summary', 'weekly-summary', 'monthly-review', 'quarterly-review',
  'board', 'incident', 'engineering', 'sales', 'finance', 'operations', 'compliance',
] as const;
export type BriefingType = (typeof BRIEFING_TYPES)[number];

/** Module 2 — enterprise memory kinds. */
export const MEMORY_KINDS = ['conversation', 'decision', 'meeting', 'operational', 'project', 'customer', 'incident', 'evidence'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** Module 9 — AI providers Wave 3 integrates (no lock-in). */
export const AI_PROVIDERS = ['anthropic', 'openai', 'google-gemini', 'ollama', 'mistral', 'qwen', 'deterministic'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

/** Module 8 — intelligence service kinds. */
export const INTELLIGENCE_SERVICES = ['risk', 'trend', 'pattern', 'anomaly', 'dependency', 'opportunity', 'recommendation', 'duplicate'] as const;
export type IntelligenceService = (typeof INTELLIGENCE_SERVICES)[number];
