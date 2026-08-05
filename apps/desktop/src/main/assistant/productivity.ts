/**
 * Assistant productivity builders (Phase 6 Stage 5) — PURE composition helpers
 * behind the meeting-prep (D-4) and Work Summary (approved addition #2) flows.
 *
 * Nothing here reads a store, calls a model, or executes anything: the wiring
 * gathers data from the EXISTING subsystems and these functions compose it into
 * `AssistantStructuredReport`s deterministically. Empty inputs produce the
 * honest empty report (`grounded:false`) — never invented content. Node-tested.
 */
import type { AssistantStructuredReport, UnifiedEntity } from '@neuropause/shared';
import { nameMatches } from './assistantModel';

/* ── Meeting preparation (D-4) ─────────────────────────────────────────────── */

/** How far ahead the "next meeting" lookup searches (48 h). */
export const MEETING_LOOKAHEAD_MS = 48 * 3_600_000;

/**
 * Pick the meeting to prepare for: a named match from the request when one
 * matches, else the next upcoming calendar entity within the lookahead.
 * Pure; null when the calendar holds nothing upcoming (honest miss).
 */
export function selectMeeting(
  entities: UnifiedEntity[],
  nowIso: string,
  requestText: string,
): UnifiedEntity | null {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return null;
  const upcoming = entities
    .filter(
      (e) =>
        (e.kind === 'calendar_event' || e.kind === 'event') &&
        e.timestamp !== null &&
        Date.parse(e.timestamp) > nowMs &&
        Date.parse(e.timestamp) <= nowMs + MEETING_LOOKAHEAD_MS,
    )
    .sort((a, b) => (a.timestamp as string).localeCompare(b.timestamp as string));
  if (upcoming.length === 0) return null;
  const named = upcoming.find((e) => nameMatches(requestText, e.title));
  return named ?? (upcoming[0] as UnifiedEntity);
}

/** Material gathered for a meeting by the wiring (existing reads only). */
export interface MeetingPrepMaterial {
  meeting: { id: string; title: string; startsAt: string | null; organizer: string | null };
  participants: string[];
  /** Related items found by the existing federated/UDM search. */
  related: { source: string; title: string }[];
  /** Recent timeline entries touching the meeting/participants. */
  timeline: { at: string; title: string }[];
  /** Recent decisions (existing decision store). */
  decisions: { title: string; status: string }[];
  /** Recalled executive memories. */
  memories: { title: string }[];
}

/**
 * Compose the deterministic meeting brief. Every section is present only when
 * its material exists; `grounded` reflects whether ANY evidence beyond the
 * meeting record itself was found.
 */
export function buildMeetingBrief(m: MeetingPrepMaterial): AssistantStructuredReport {
  const sections: AssistantStructuredReport['sections'] = [];
  const when = m.meeting.startsAt ? ` — ${m.meeting.startsAt}` : '';
  sections.push({
    title: 'Meeting',
    lines: [
      `${m.meeting.title}${when}`,
      ...(m.meeting.organizer ? [`Organizer: ${m.meeting.organizer}`] : []),
    ],
  });
  if (m.participants.length > 0)
    sections.push({ title: 'Participants', lines: m.participants.slice(0, 10) });
  if (m.related.length > 0)
    sections.push({
      title: 'Related material',
      lines: m.related.slice(0, 8).map((r) => `[${r.source}] ${r.title}`),
    });
  if (m.timeline.length > 0)
    sections.push({
      title: 'Recent activity',
      lines: m.timeline.slice(0, 6).map((t) => `${t.at.slice(0, 10)} — ${t.title}`),
    });
  if (m.decisions.length > 0)
    sections.push({
      title: 'Open decisions',
      lines: m.decisions.slice(0, 5).map((d) => `${d.title} (${d.status})`),
    });
  if (m.memories.length > 0)
    sections.push({ title: 'From memory', lines: m.memories.slice(0, 5).map((x) => x.title) });
  const grounded =
    m.participants.length + m.related.length + m.timeline.length + m.decisions.length + m.memories.length >
    0;
  return { kind: 'meeting-brief', title: `Meeting prep: ${m.meeting.title}`, sections, grounded };
}

/** Render a structured report as plain material lines for a grounding prompt. */
export function renderReportMaterial(report: AssistantStructuredReport): string {
  const lines: string[] = [];
  for (const s of report.sections) {
    lines.push(`${s.title}:`);
    for (const l of s.lines) lines.push(`- ${l}`);
  }
  return lines.length > 0 ? lines.join('\n') : '(no material)';
}

/* ── Work Summary (approved Stage 5 addition #2) ───────────────────────────── */

/**
 * Inputs are aggregates of EXISTING operational records, gathered by the
 * wiring for the local day. Descriptive by design — no score, no gamification.
 */
export interface WorkSummaryInputs {
  nowIso: string;
  /** Assistant memory-store tasks (D-3 lens). */
  assistantTasks: { title: string; status: string; updatedAt: string }[];
  /** Connector (UDM) tasks completed today. */
  connectorTasksCompletedToday: string[];
  /** Today's meetings (UDM calendar titles, started or starting today). */
  meetingsToday: string[];
  /** ExecuteEngine sessions started today. */
  executionsToday: { label: string; state: string }[];
  /** Automation runs today. */
  automationRunsToday: { ok: boolean }[];
  /** Workforce jobs created today + proposals still parked. */
  jobsToday: number;
  pendingApprovals: number;
  /** Assistant conversations touched today. */
  conversationsToday: number;
  /** Open connector problems (live). */
  connectorProblems: { id: string; reason: string }[];
}

const sameDay = (iso: string, nowIso: string): boolean => iso.slice(0, 10) === nowIso.slice(0, 10);

/** Compose the descriptive daily Work Summary. Pure; empty day ⇒ grounded:false. */
export function buildWorkSummary(i: WorkSummaryInputs): AssistantStructuredReport {
  const sections: AssistantStructuredReport['sections'] = [];

  const tasksDoneToday = i.assistantTasks.filter(
    (t) => t.status === 'done' && sameDay(t.updatedAt, i.nowIso),
  );
  const tasksOpen = i.assistantTasks.filter((t) => t.status !== 'done');
  const executionsDone = i.executionsToday.filter((e) => e.state === 'completed');
  const executionsFailed = i.executionsToday.filter((e) => e.state === 'failed');
  const runsOk = i.automationRunsToday.filter((r) => r.ok).length;
  const runsFailed = i.automationRunsToday.length - runsOk;

  const completed: string[] = [];
  if (tasksDoneToday.length > 0)
    completed.push(
      `${tasksDoneToday.length} assistant task(s) completed: ${tasksDoneToday.slice(0, 5).map((t) => t.title).join('; ')}`,
    );
  if (i.connectorTasksCompletedToday.length > 0)
    completed.push(
      `${i.connectorTasksCompletedToday.length} connected-system task(s) completed: ${i.connectorTasksCompletedToday.slice(0, 5).join('; ')}`,
    );
  if (executionsDone.length > 0)
    completed.push(`${executionsDone.length} execution(s) completed (ExecuteEngine).`);
  if (runsOk > 0) completed.push(`${runsOk} automation run(s) succeeded.`);
  if (completed.length > 0) sections.push({ title: 'Completed today', lines: completed });

  if (i.meetingsToday.length > 0)
    sections.push({
      title: 'Meetings today',
      lines: [`${i.meetingsToday.length} meeting(s): ${i.meetingsToday.slice(0, 6).join('; ')}`],
    });

  const ai: string[] = [];
  if (i.conversationsToday > 0) ai.push(`${i.conversationsToday} assistant conversation(s) active.`);
  if (i.jobsToday > 0) ai.push(`${i.jobsToday} AI workforce job(s) ran.`);
  if (ai.length > 0) sections.push({ title: 'AI assistance', lines: ai });

  const open: string[] = [];
  if (i.pendingApprovals > 0)
    open.push(`${i.pendingApprovals} proposal(s) still waiting for your approval.`);
  if (tasksOpen.length > 0) open.push(`${tasksOpen.length} assistant task(s) still open.`);
  if (open.length > 0) sections.push({ title: 'Still open', lines: open });

  const risks: string[] = [];
  for (const p of i.connectorProblems.slice(0, 5)) risks.push(`Connector ${p.id}: ${p.reason}`);
  if (executionsFailed.length > 0) risks.push(`${executionsFailed.length} execution(s) failed today.`);
  if (runsFailed > 0) risks.push(`${runsFailed} automation run(s) failed today.`);
  if (risks.length > 0) sections.push({ title: 'Risks & blockers', lines: risks });

  return {
    kind: 'work-summary',
    title: `Work summary — ${i.nowIso.slice(0, 10)}`,
    sections,
    grounded: sections.length > 0,
  };
}
