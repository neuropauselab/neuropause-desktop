/**
 * Wave 11 constants. Isolated module (no imports).
 */
export const WORKFORCE_VERSION = '0.0.0-preview.1';

/** The one honest answer executive AI gives when no real data exists. */
export const NO_WORKFORCE_DATA = 'No business data available';

/** Module 1 — agent lifecycle states. */
export const AGENT_STATES = ['provisioned', 'active', 'suspended', 'retired'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** Module 2 — department (C-suite) AI assistants. */
export const DEPARTMENT_WORKERS = ['CEO Assistant', 'COO Assistant', 'CFO Assistant', 'CRO Assistant', 'CTO Assistant', 'CIO Assistant', 'CHRO Assistant'] as const;

/** Module 3 — business AI workers. */
export const BUSINESS_WORKERS = [
  'Sales Executive',
  'CRM Manager',
  'Customer Success Manager',
  'Procurement Officer',
  'Finance Analyst',
  'Accountant',
  'HR Manager',
  'Recruiter',
  'Project Manager',
  'Portfolio Manager',
  'Inventory Manager',
  'Manufacturing Planner',
  'Quality Manager',
  'Compliance Officer',
  'Legal Assistant',
  'Executive Assistant',
] as const;

/** Module 4 — industry AI specialists (reuse Wave 9). */
export const INDUSTRY_SPECIALISTS = ['Healthcare', 'Medical Device', 'Retail', 'Logistics', 'Banking', 'Insurance', 'Government', 'Education', 'Hospitality', 'Construction', 'Manufacturing', 'Pharma'] as const;

/** Module 9 — memory scopes. */
export const MEMORY_SCOPES = ['long-term', 'session', 'organization', 'team', 'workspace-context'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

/** Module 8 — governed tool domains an agent may use (only through governed APIs). */
export const TOOL_DOMAINS = ['crm', 'erp', 'finance', 'hr', 'procurement', 'inventory', 'manufacturing', 'workspace', 'search', 'documents', 'calendar', 'knowledge', 'marketplace', 'connectors'] as const;
export type ToolDomain = (typeof TOOL_DOMAINS)[number];

/** Regulated actions that are REPRESENTED only — never executed autonomously. */
export const REGULATED_ACTIONS = ['financial-approval', 'payroll', 'banking', 'tax-filing', 'clinical-decision', 'legal-decision', 'production-change', 'security-policy'] as const;
export type RegulatedAction = (typeof REGULATED_ACTIONS)[number];

/** Module 18 — external AI provider categories (adapter-verified). */
export const AI_PROVIDER_CATALOG: Array<{ system: string; category: string }> = [
  { system: 'External LLM Provider', category: 'llm' },
  { system: 'Voice Provider', category: 'voice' },
  { system: 'Translation Service', category: 'translation' },
  { system: 'OCR Service', category: 'ocr' },
];

/** Module 15 — AI marketplace item kinds. */
export const WORKER_MARKET_KINDS = ['worker', 'skill', 'tool', 'template', 'prompt-pack'] as const;
export type WorkerMarketKind = (typeof WORKER_MARKET_KINDS)[number];

/** Module 16 — worker SDK module kinds. */
export const SDK_MODULE_KINDS = ['worker', 'skill', 'tool', 'planning', 'memory', 'reasoning'] as const;
export type SdkModuleKind = (typeof SDK_MODULE_KINDS)[number];

/** Module 14 — executive briefing roles. */
export const EXECUTIVE_BRIEFINGS = ['CEO', 'CFO', 'COO', 'CTO', 'CRO', 'CHRO'] as const;
export type ExecutiveBriefingRole = (typeof EXECUTIVE_BRIEFINGS)[number];
