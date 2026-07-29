/**
 * Wave 4 constants. Isolated module (no imports).
 */
export const AUTOMATION_VERSION = '0.0.0-preview.1';

export const WORKFLOW_MODES = ['sequential', 'parallel'] as const;
export type WorkflowMode = (typeof WORKFLOW_MODES)[number];

export const STEP_KINDS = ['action', 'approval', 'condition', 'loop', 'parallel', 'notify'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** Human-in-the-loop risk tiers (Module 8). */
export const RISK_TIERS = ['low', 'medium', 'high', 'restricted'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

/** Operations AI is allowed to perform autonomously (assistive only). */
export const AI_ALLOWED_OPERATIONS = ['recommend', 'draft', 'summarize', 'prioritize', 'detect-risk', 'suggest-action'] as const;
/** Operations that ALWAYS require explicit human approval — AI may never do these alone. */
export const HUMAN_REQUIRED_OPERATIONS = ['approve-contract', 'delete-data', 'grant-permission', 'execute-high-risk'] as const;

export const TRIGGER_KINDS = ['scheduled', 'cron', 'event', 'manual', 'conditional', 'recurring', 'delayed'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const NOTIFICATION_CHANNELS = ['email', 'slack', 'in-app', 'push', 'webhook', 'sms'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Module 4 — the ten built-in playbooks. */
export const PLAYBOOKS = [
  'employee-onboarding', 'incident-response', 'release-management', 'customer-onboarding', 'design-partner-onboarding',
  'compliance-evidence-collection', 'quarterly-okr-review', 'risk-escalation', 'security-incident', 'vendor-review',
] as const;
export type PlaybookId = (typeof PLAYBOOKS)[number];

/** Module 13 — operations dashboard roles. */
export const OPS_ROLES = ['CEO', 'COO', 'CTO', 'Operations', 'Customer Success', 'Engineering', 'Compliance'] as const;
export type OpsRole = (typeof OPS_ROLES)[number];
