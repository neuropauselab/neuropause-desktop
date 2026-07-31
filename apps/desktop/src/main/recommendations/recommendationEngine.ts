/**
 * The recommendation engine. Deterministic rules over the UDM and timeline,
 * each producing recommendations grounded in cited evidence:
 *
 *   - open tasks → "continue" (recent) or "stale" (untouched > 14d),
 *   - projects with open tasks but no recorded activity → "may be stalled",
 *   - unread notifications → "unanswered",
 *   - calendar events within 3 days → "upcoming deadline".
 *
 * Pure (entities + timeline injected), so it unit-tests from synthetic data.
 */
import type {
  EnterpriseTimelineEntry,
  Recommendation,
  RecommendationKind,
  RecommendationPriority,
  RecommendationQuery,
  UnifiedEntity,
} from '@neuropause/shared';
import { classifyStatus, clamp01, daysBetween, eventTime, isOpenTask } from '../intelligence/classify';

export interface RecommendationInput {
  entities: UnifiedEntity[];
  events: EnterpriseTimelineEntry[];
  now: string;
  /* ── Phase 6 Stage 5 — additive aux inputs (all optional; rules that need an
     absent input simply produce nothing — never a guess). ── */
  /** Workforce proposals parked for a human. */
  pendingApprovals?: { jobId: string; title: string; workerName: string; createdAt: string }[];
  /** Connector runtime state (id + a problem string when unhealthy). */
  connectors?: { id: string; problem: string | null }[];
  /** Recent ExecuteEngine history (for repeated-manual-run detection). */
  executionHistory?: { kind: string; targetId: string | null; label: string; startedAt: string; state: string }[];
  /** Assistant conversation summaries (waiting plan steps = follow-up signal). */
  conversations?: { id: string; title: string; updatedAt: string; waitingSteps: number }[];
}

const STALE_DAYS = 14;
const DEADLINE_DAYS = 3;

function rec(
  kind: RecommendationKind,
  title: string,
  rationale: string,
  priority: RecommendationPriority,
  score: number,
  e: UnifiedEntity,
): Recommendation {
  return {
    id: `rec:${kind}:${e.id}`,
    kind,
    title,
    rationale,
    priority,
    score: clamp01(score),
    connectorId: e.connectorId,
    entityRefs: [e.id],
    evidence: [{ kind: e.kind, id: e.id }],
  };
}

export function generateRecommendations(
  input: RecommendationInput,
  query: RecommendationQuery = {},
): Recommendation[] {
  const recs: Recommendation[] = [];

  // Latest recorded activity per entity, from the timeline.
  const lastActivity = new Map<string, string>();
  for (const ev of input.events) {
    for (const ref of ev.entityRefs) {
      const prev = lastActivity.get(ref);
      if (!prev || ev.at > prev) lastActivity.set(ref, ev.at);
    }
  }

  const openTasks = input.entities.filter(isOpenTask);

  // Open tasks → stale (old) or next (recent).
  for (const t of openTasks) {
    const age = daysBetween(eventTime(t), input.now);
    if (age > STALE_DAYS) {
      recs.push(
        rec('stale_task', `Stale task: ${t.title}`, `No update in ${Math.floor(age)} days.`, 'high', 0.6 + age / 120, t),
      );
    } else {
      recs.push(
        rec('next_task', `Continue: ${t.title}`, `Open task, last touched ${Math.floor(age)}d ago.`, 'normal', 0.5 - age / 60, t),
      );
    }
  }

  // Projects with open child tasks but no recorded activity → stalled.
  const projects = input.entities.filter(
    (e) => e.kind === 'project' && classifyStatus(e.status) !== 'archived',
  );
  for (const p of projects) {
    const childOpen = openTasks.filter((t) => t.containerId === p.id);
    if (childOpen.length === 0) continue;
    const last = lastActivity.get(p.id);
    const idle = last ? daysBetween(last, input.now) : Number.POSITIVE_INFINITY;
    if (idle > STALE_DAYS) {
      recs.push({
        id: `rec:blocked_project:${p.id}`,
        kind: 'blocked_project',
        title: `Project may be stalled: ${p.title}`,
        rationale: `${childOpen.length} open task(s) and no recorded activity in ${
          Number.isFinite(idle) ? `${Math.floor(idle)} days` : 'a while'
        }.`,
        priority: 'high',
        score: clamp01(0.7),
        connectorId: p.connectorId,
        entityRefs: [p.id, ...childOpen.map((t) => t.id)],
        evidence: [{ kind: 'project', id: p.id }, ...childOpen.slice(0, 3).map((t) => ({ kind: 'task', id: t.id }))],
      });
    }
  }

  // Unread notifications → unanswered.
  for (const n of input.entities.filter(
    (e) => e.kind === 'notification' && classifyStatus(e.status) === 'unread',
  )) {
    recs.push(rec('unanswered', `Unread: ${n.title}`, 'Unread notification awaiting a response.', 'normal', 0.45, n));
  }

  // Calendar events within the deadline horizon → upcoming.
  for (const e of input.entities.filter(
    (x) => (x.kind === 'calendar_event' || x.kind === 'event') && x.timestamp !== null && x.timestamp > input.now,
  )) {
    const days = daysBetween(input.now, e.timestamp as string);
    if (days <= DEADLINE_DAYS) {
      recs.push(
        rec(
          'upcoming_deadline',
          `Upcoming: ${e.title}`,
          `Scheduled in ${days < 1 ? 'under a day' : `${Math.ceil(days)} day(s)`}.`,
          days < 1 ? 'high' : 'normal',
          0.8 - days / 10,
          e,
        ),
      );
    }
  }

  /* ── Phase 6 Stage 5 — additive productivity rules. Deterministic, evidence-
     backed, and explainable: every one carries suggestedAction, affectedSystems,
     and confidence (5.11). Absent aux inputs → the rule is silent. ── */

  // Workforce proposals awaiting a human → open_approval.
  for (const p of input.pendingApprovals ?? []) {
    const age = daysBetween(p.createdAt, input.now);
    recs.push({
      id: `rec:open_approval:${p.jobId}`,
      kind: 'open_approval',
      title: `Approval waiting: ${p.title}`,
      rationale: `${p.workerName} proposed this ${age < 1 ? 'today' : `${Math.floor(age)} day(s) ago`} and it is still parked for a decision.`,
      priority: age > 2 ? 'high' : 'normal',
      score: clamp01(0.65 + Math.min(age, 10) / 30),
      connectorId: null,
      entityRefs: [p.jobId],
      evidence: [{ kind: 'job', id: p.jobId }],
      suggestedAction: 'Review and approve or reject the proposal in the Approval Center.',
      affectedSystems: ['workforce', 'approvals'],
      confidence: 1,
    });
  }

  // Unhealthy connectors → connector_issue.
  for (const c of input.connectors ?? []) {
    if (c.problem === null) continue;
    recs.push({
      id: `rec:connector_issue:${c.id}`,
      kind: 'connector_issue',
      title: `Connector problem: ${c.id}`,
      rationale: c.problem,
      priority: 'high',
      score: clamp01(0.75),
      connectorId: c.id,
      entityRefs: [c.id],
      evidence: [{ kind: 'connector', id: c.id }],
      suggestedAction: 'Open Connections and re-check the connector (reconnect or re-sync).',
      affectedSystems: ['connectors', 'sync'],
      confidence: 1,
    });
  }

  // The same automation run manually ≥3 times in 7 days → automation_opportunity.
  const manualRuns = new Map<string, { label: string; count: number; last: string }>();
  for (const h of input.executionHistory ?? []) {
    if (h.kind !== 'automation' || !h.targetId || h.state !== 'completed') continue;
    if (daysBetween(h.startedAt, input.now) > 7) continue;
    const prev = manualRuns.get(h.targetId);
    if (prev) {
      prev.count += 1;
      if (h.startedAt > prev.last) prev.last = h.startedAt;
    } else {
      manualRuns.set(h.targetId, { label: h.label, count: 1, last: h.startedAt });
    }
  }
  for (const [ruleId, m] of manualRuns) {
    if (m.count < 3) continue;
    recs.push({
      id: `rec:automation_opportunity:${ruleId}`,
      kind: 'automation_opportunity',
      title: `Schedule it: ${m.label}`,
      rationale: `Run manually ${m.count} times in the last 7 days — a trigger or schedule would remove the repetition.`,
      priority: 'normal',
      score: clamp01(0.5 + m.count / 20),
      connectorId: null,
      entityRefs: [ruleId],
      evidence: [{ kind: 'automation', id: ruleId }],
      suggestedAction: 'Add a schedule or event trigger to this automation in the Automation Center.',
      affectedSystems: ['automation', 'execute-engine'],
      confidence: 0.9,
    });
  }

  // Assistant conversations with plan steps still parked → followup_conversation.
  for (const c of input.conversations ?? []) {
    if (c.waitingSteps <= 0) continue;
    const age = daysBetween(c.updatedAt, input.now);
    recs.push({
      id: `rec:followup_conversation:${c.id}`,
      kind: 'followup_conversation',
      title: `Follow up: ${c.title}`,
      rationale: `${c.waitingSteps} plan step(s) are still waiting for your decision${age >= 1 ? ` (idle ${Math.floor(age)} day(s))` : ''}.`,
      priority: age > 1 ? 'high' : 'normal',
      score: clamp01(0.6 + Math.min(age, 10) / 25),
      connectorId: null,
      entityRefs: [c.id],
      evidence: [{ kind: 'conversation', id: c.id }],
      suggestedAction: 'Open the conversation in the Assistant and decide the waiting steps.',
      affectedSystems: ['assistant', 'approvals'],
      confidence: 1,
    });
  }

  // Unread messages older than 2 days → unanswered_email.
  for (const m of input.entities.filter(
    (e) => e.kind === 'message' && classifyStatus(e.status) === 'unread',
  )) {
    const age = daysBetween(eventTime(m), input.now);
    if (age < 2) continue;
    recs.push({
      id: `rec:unanswered_email:${m.id}`,
      kind: 'unanswered_email',
      title: `Unanswered: ${m.title}`,
      rationale: `Unread for ${Math.floor(age)} day(s)${m.author ? ` (from ${m.author})` : ''}.`,
      priority: age > 5 ? 'high' : 'normal',
      score: clamp01(0.45 + Math.min(age, 14) / 40),
      connectorId: m.connectorId,
      entityRefs: [m.id],
      evidence: [{ kind: 'message', id: m.id }],
      suggestedAction: 'Ask the assistant to draft a reply for your review.',
      affectedSystems: ['email'],
      confidence: 0.9,
    });
  }

  let out = recs;
  if (query.kinds && query.kinds.length > 0) {
    const k = new Set(query.kinds);
    out = out.filter((r) => k.has(r.kind));
  }
  out.sort((a, b) => b.score - a.score);
  const limit = query.limit ?? 50;
  return out.slice(0, limit);
}
