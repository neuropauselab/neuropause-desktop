/**
 * @neuropause/automation — NEMS Wave 4 Enterprise Automation Platform. Composes the
 * existing platform (runtime audit chain + event bus, ai-runtime, intelligence,
 * connectivity, NEMS, persistence, security) into an automation layer: a workflow engine
 * (sequential/parallel/conditional/loop/approval/timeout/retry/compensation), an
 * automation engine (scheduled/event/manual triggers, priority + delayed queues), a
 * multi-level approval platform, ten enterprise playbooks, event automation over internal
 * runtime events, a notification platform, task orchestration, a human-in-the-loop policy
 * gate, SLA + analytics, governance, and operations dashboards.
 *
 * Automation assists people and never bypasses governance: every workflow is audited,
 * tenant-aware, replayable, versioned, evidence-linked, and permission-checked; AI may
 * recommend/draft/summarize but may not approve/delete/grant/execute high-risk operations
 * without explicit human approval. Internal-system automation is LIVE-VERIFIED; steps
 * touching external SaaS or real notification delivery are adapter-verified with live
 * execution INFRA-PENDING — never fabricated as performed.
 */
export * from './constants';
export * from './types';
export * from './evidence';
export * from './governance';
export * from './approvals';
export * from './hitl';
export * from './workflow';
export * from './automation';
export * from './events';
export * from './notifications';
export * from './tasks';
export * from './sla';
export * from './analytics';
export * from './playbooks';
export * from './dashboards';
export * from './platform';
