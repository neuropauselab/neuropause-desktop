/**
 * Wave 4 capability evidence matrix (honesty ledger), per the HONESTY REQUIREMENTS.
 *   live-verified    — executed in-process over the real platform in THIS environment
 *   adapter-verified — validated through a reusable interface / simulated provider
 *   demo-data        — fictional data for UI/tests
 *   infra-pending    — needs a real external integration / operator config
 * A test asserts the invariant: nothing that performs external side effects (live SaaS
 * calls, real email/Slack/SMS delivery, external webhooks) is marked live-verified.
 */
export type EvidenceLevel = 'live-verified' | 'adapter-verified' | 'demo-data' | 'infra-pending';

export interface CapabilityEvidence {
  capability: string;
  module: string;
  level: EvidenceLevel;
  note: string;
}

export const AUTOMATION_MATRIX: CapabilityEvidence[] = [
  { capability: 'Workflow Engine', module: 'M1', level: 'live-verified', note: 'Sequential/parallel/conditional/loop/approval/timeout/retry/compensation all execute in-process and are tested.' },
  { capability: 'Automation Engine (triggers/queue)', module: 'M2', level: 'live-verified', note: 'Scheduled/manual/conditional triggers + priority/delayed queue run against a deterministic clock; internal event triggers use the real runtime event bus.' },
  { capability: 'Approval Platform', module: 'M3', level: 'live-verified', note: 'Multi-level approvals, delegation, escalation, digital sign-off — all in-process, audited.' },
  { capability: 'Human-in-the-Loop gate', module: 'M8', level: 'live-verified', note: 'AI-allowed vs human-required operation classes are enforced; AI is blocked from restricted ops without explicit human approval.' },
  { capability: 'Task Orchestration', module: 'M7', level: 'live-verified', note: 'Create/assign/dependencies/priorities/deadlines/completion/escalation — in-process, audited.' },
  { capability: 'SLA & Operations', module: 'M9', level: 'live-verified', note: 'Duration/queue/failures/retries/SLA compliance/completion computed over real execution history.' },
  { capability: 'Automation Analytics', module: 'M10', level: 'live-verified', note: 'Success rate/automation rate/manual intervention/approval time/bottlenecks/failure causes over real history.' },
  { capability: 'Governance', module: 'M12', level: 'live-verified', note: 'Every execution audited on the one chain + event bus with audit/replay/rollback ids; replay re-runs from the stored definition.' },
  { capability: 'Operations Dashboards', module: 'M13', level: 'live-verified', note: 'Seven role dashboards computed from live SLA/analytics/approval/queue state.' },
  { capability: 'Event Automation — internal events', module: 'M5', level: 'live-verified', note: 'Reacts to real NEMS/connector/audit/runtime/intelligence events on the one event bus.' },
  { capability: 'Enterprise Playbooks — internal steps', module: 'M4', level: 'live-verified', note: 'Playbook steps that use NEMS/graph/memory/approvals/in-app notifications execute end-to-end.' },
  { capability: 'Notification Platform — in-app', module: 'M6', level: 'live-verified', note: 'In-app/recording channel delivers and is audited.' },
  { capability: 'Notification Platform — email/Slack/SMS/push/webhook', module: 'M6', level: 'infra-pending', note: 'Real delivery needs operator SMTP/Slack/SMS/webhook config — queued and labelled, never marked delivered.' },
  { capability: 'Playbook steps — external SaaS', module: 'M4', level: 'adapter-verified', note: 'Steps calling GitHub/Slack/Jira/Gmail go through Wave 2 connectors (adapter-verified); live execution infra-pending. Demo data in tests.' },
  { capability: 'Event Automation — external SaaS webhooks', module: 'M5', level: 'adapter-verified', note: 'GitHub/Slack/Jira/Calendar webhook reactions are wired via Wave 2 WebhookReceiver; delivery of real webhooks is infra-pending.' },
];

export interface AutomationReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  demoData: number;
  infraPending: number;
}

export function automationReadiness(matrix: CapabilityEvidence[] = AUTOMATION_MATRIX): AutomationReadiness {
  const by = (l: EvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return { total: matrix.length, liveVerified: by('live-verified'), adapterVerified: by('adapter-verified'), demoData: by('demo-data'), infraPending: by('infra-pending') };
}
