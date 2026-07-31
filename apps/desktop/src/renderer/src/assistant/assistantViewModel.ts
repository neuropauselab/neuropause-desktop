/**
 * Workspace Assistant — pure renderer view-model (Phase 6 Stage 4).
 * Display metadata + the Session Inspector's deterministic level filtering.
 * No React, no DOM, no IPC — node-tested.
 */
import type {
  AssistantEnvelope,
  AssistantPlanStep,
  AssistantStepState,
  AssistantTrace,
  AssistantTraceLevel,
} from '@neuropause/shared';
import { ASSISTANT_TRACE_LEVEL_DETAIL } from '@neuropause/shared';

/* ── Step + plan display meta ──────────────────────────────────────────────── */

export const STEP_STATE_META: Record<AssistantStepState, { label: string; tone: 'ink' | 'green' | 'orange' | 'red' | 'faint' }> = {
  pending: { label: 'Pending', tone: 'faint' },
  waiting: { label: 'Waiting for approval', tone: 'orange' },
  running: { label: 'Running', tone: 'ink' },
  completed: { label: 'Completed', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  rejected: { label: 'Rejected', tone: 'faint' },
  cancelled: { label: 'Cancelled', tone: 'faint' },
  skipped: { label: 'Not run', tone: 'faint' },
};

/** Approval card content — what/why/impact/rollback, all from the step itself. */
export interface ApprovalCardModel {
  stepId: string;
  what: string;
  why: string;
  impact: string;
  rollback: string;
  risk: AssistantPlanStep['risk'];
}

export function approvalCard(step: AssistantPlanStep): ApprovalCardModel {
  return {
    stepId: step.id,
    what: `${step.label} — ${step.purpose}`,
    why: step.reason,
    impact: `${step.expectedOutput}${step.sideEffects ? ' This step has real side effects.' : ''}`,
    rollback: step.rollback,
    risk: step.risk,
  };
}

/** The steps currently needing a human decision. */
export function stepsAwaitingApproval(envelope: AssistantEnvelope): AssistantPlanStep[] {
  return envelope.plan?.steps.filter((s) => s.state === 'waiting' && s.needsApproval) ?? [];
}

/* ── Session Inspector — role-appropriate views over ONE trace ─────────────── */

export interface InspectorSection {
  id: string;
  title: string;
  rows: { label: string; value: string }[];
}

/**
 * Deterministic level filtering: the same trace, three depths. Nothing outside
 * the shared level map is ever revealed or hidden ad hoc.
 */
export function inspectorSections(trace: AssistantTrace, level: AssistantTraceLevel): InspectorSection[] {
  const detail = ASSISTANT_TRACE_LEVEL_DETAIL[level];
  const sections: InspectorSection[] = [];

  sections.push({
    id: 'turn',
    title: 'Turn',
    rows: [
      { label: 'Correlation ID', value: trace.correlationId },
      { label: 'Mode', value: trace.mode },
      {
        label: 'Intent',
        value: `${trace.intent.intent} (${Math.round(trace.intent.confidence * 100)}%${trace.intent.matched.length ? ` — ${trace.intent.matched.join(', ')}` : ''})`,
      },
    ],
  });

  const ws = trace.workspace;
  const contextRows: { label: string; value: string }[] = [];
  if (ws.workspace) contextRows.push({ label: 'Workspace', value: ws.workspace.name });
  if (ws.activeExecutions !== null) contextRows.push({ label: 'Active executions', value: String(ws.activeExecutions) });
  if (ws.pendingApprovals !== null) contextRows.push({ label: 'Pending approvals', value: String(ws.pendingApprovals) });
  if (ws.connectors) contextRows.push({ label: 'Connectors', value: `${ws.connectors.connected}/${ws.connectors.total} connected` });
  if (ws.uiContext?.section) contextRows.push({ label: 'Screen', value: ws.uiContext.section });
  for (const u of ws.unavailable) contextRows.push({ label: `Unavailable — ${u.system}`, value: u.reason });
  sections.push({ id: 'context', title: 'Context', rows: contextRows });

  const retrievalRows: { label: string; value: string }[] = [
    { label: 'Items retrieved', value: String(trace.retrieved.length) },
    { label: 'Memories recalled', value: String(trace.recalledMemories) },
  ];
  if (detail.showRetrievedItems) {
    trace.retrieved.forEach((r, i) => {
      retrievalRows.push({ label: `${i + 1}. ${r.source}`, value: r.text.length > 140 ? `${r.text.slice(0, 137)}…` : r.text });
    });
  }
  sections.push({ id: 'retrieval', title: 'Retrieval', rows: retrievalRows });

  const reasoningRows: { label: string; value: string }[] = [];
  if (trace.reasoning) {
    reasoningRows.push({ label: 'Grounded', value: trace.reasoning.grounded ? 'yes' : 'no (deterministic fallback)' });
    reasoningRows.push({ label: 'Confidence', value: `${Math.round(trace.reasoning.confidence * 100)}%` });
    if (detail.showReasoningInternals) {
      reasoningRows.push({ label: 'Prompt', value: `${trace.reasoning.promptId} v${trace.reasoning.promptVersion}` });
      reasoningRows.push({ label: 'Model', value: trace.reasoning.model });
      reasoningRows.push({ label: 'Latency', value: `${trace.reasoning.latencyMs}ms` });
      reasoningRows.push({
        label: 'Tokens',
        value: `${trace.reasoning.inputTokens} in / ${trace.reasoning.outputTokens} out ($${trace.reasoning.costUsd.toFixed(4)})`,
      });
      reasoningRows.push({ label: 'Context sources', value: trace.reasoning.contextSources.join(', ') || '—' });
    }
  } else {
    reasoningRows.push({ label: 'Reasoning', value: 'No model call this turn (by mode or clarification).' });
  }
  sections.push({ id: 'reasoning', title: 'Reasoning', rows: reasoningRows });

  sections.push({
    id: 'tools',
    title: 'Tool calls',
    rows: trace.toolCalls.map((t) => ({
      label: `${t.label} (${t.outcome})`,
      value: `${t.purpose}${t.detail ? ` — ${t.detail}` : ''}${detail.showPhaseTimings ? ` · ${t.durationMs}ms` : ''}`,
    })),
  });

  if (detail.showPhaseTimings) {
    sections.push({
      id: 'timings',
      title: 'Phase timings',
      rows: trace.phases.map((p) => ({ label: p.phase, value: `${p.durationMs}ms` })),
    });
  }

  if (detail.showAuditReferences) {
    sections.push({
      id: 'audit',
      title: 'Audit (administrator)',
      rows: [
        { label: 'Permission class', value: trace.audit.permissionClass },
        { label: 'AI audit record', value: trace.audit.aiResponseId ?? '— (no model call)' },
        { label: 'Execution sessions', value: trace.audit.executionIds.join(', ') || '—' },
        { label: 'Timeline events', value: trace.audit.timelineEventTypes.join(', ') || '—' },
      ],
    });
  }

  return sections;
}

/** Everything the envelope explains, compacted for the "How this was produced" strip. */
export function explanationSummary(envelope: AssistantEnvelope): string {
  const bits: string[] = [];
  bits.push(`${envelope.sources.length} source${envelope.sources.length === 1 ? '' : 's'}`);
  bits.push(`${envelope.toolCalls.length} tool call${envelope.toolCalls.length === 1 ? '' : 's'}`);
  if (envelope.aiOffline) bits.push('AI offline — deterministic only');
  else bits.push(`confidence ${Math.round(envelope.confidence * 100)}%`);
  if (envelope.unavailable.length > 0) bits.push(`${envelope.unavailable.length} unavailable`);
  if (envelope.assumptions.length > 0) bits.push(`${envelope.assumptions.length} assumption${envelope.assumptions.length === 1 ? '' : 's'}`);
  return bits.join(' · ');
}
