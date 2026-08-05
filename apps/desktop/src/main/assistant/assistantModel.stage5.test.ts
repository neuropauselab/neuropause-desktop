/**
 * Phase 6 Stage 5 — pure-model additions: the `task` intent (D-3), the
 * deterministic task-command parser, the conservative due-date parser, and the
 * brief / work-summary / meeting-prep resolvers (D-2/D-4 + addition #2).
 * Locks the honesty contract: unparseable → null (clarification), never a guess.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  classifyAssistantIntent,
  parseDueDate,
  parseTaskCommand,
  resolveBriefRequest,
  resolveMeetingPrep,
  resolveWorkSummary,
  resetPlanStepIds,
} from './assistantModel';

const NOW = '2026-07-31T09:00:00.000Z';

describe('task intent (12th class, additive)', () => {
  it('classifies task-management verbs as task', () => {
    expect(classifyAssistantIntent('add a task to send the Q3 deck').intent).toBe('task');
    expect(classifyAssistantIntent('create a to-do for the audit').intent).toBe('task');
    expect(classifyAssistantIntent('remind me to call Sam in 2 hours').intent).toBe('task');
    expect(classifyAssistantIntent('mark the deck task as done').intent).toBe('task');
    expect(classifyAssistantIntent('show my open tasks').intent).toBe('task');
    expect(classifyAssistantIntent('schedule a follow-up on the invoice').intent).toBe('task');
    expect(classifyAssistantIntent('delegate the research task to the Researcher').intent).toBe('task');
  });

  it('does not reclassify the Stage 4 phrases (backward compatibility)', () => {
    expect(classifyAssistantIntent('draft a customer response email about the delay').intent).toBe('content-creation');
    expect(classifyAssistantIntent('launch the onboarding automation').intent).toBe('automation');
    expect(classifyAssistantIntent('find every invoice overdue by 30 days').intent).toBe('search');
    expect(classifyAssistantIntent('how many connectors are connected?').intent).toBe('question');
    expect(classifyAssistantIntent('open mission control').intent).toBe('navigation');
  });

  it('wins the tie against content-creation when both fire ("create a task to draft…")', () => {
    expect(classifyAssistantIntent('create a task to draft the email reply').intent).toBe('task');
  });
});

describe('parseDueDate (conservative — null when unsure)', () => {
  it('parses relative offsets deterministically', () => {
    expect(parseDueDate('in 30 minutes', NOW)?.at).toBe('2026-07-31T09:30:00.000Z');
    expect(parseDueDate('in 2 hours', NOW)?.at).toBe('2026-07-31T11:00:00.000Z');
    expect(parseDueDate('in 3 days', NOW)?.at).toBe('2026-08-03T09:00:00.000Z');
    expect(parseDueDate('tomorrow', NOW)?.at).toBe('2026-08-01T09:00:00.000Z');
    expect(parseDueDate('next week', NOW)?.at).toBe('2026-08-07T09:00:00.000Z');
  });

  it('returns null for vague times instead of guessing', () => {
    expect(parseDueDate('this evening', NOW)).toBeNull();
    expect(parseDueDate('sometime soon', NOW)).toBeNull();
    expect(parseDueDate('at some point', NOW)).toBeNull();
  });
});

describe('parseTaskCommand', () => {
  it('parses create with title, due, and priority', () => {
    const cmd = parseTaskCommand('add a task to send the Q3 deck tomorrow, urgent', NOW);
    expect(cmd).toMatchObject({ action: 'create', priority: 'high', remind: false });
    expect(cmd?.title).toBe('send the Q3 deck');
    expect(cmd?.due).toBe('2026-08-01T09:00:00.000Z');
  });

  it('parses remind-me as create with remind=true', () => {
    const cmd = parseTaskCommand('remind me to call Sam in 2 hours', NOW);
    expect(cmd).toMatchObject({ action: 'create', remind: true });
    expect(cmd?.title).toBe('call Sam');
    expect(cmd?.due).toBe('2026-07-31T11:00:00.000Z');
  });

  it('remind-me without a parseable time keeps due null (no guessing)', () => {
    const cmd = parseTaskCommand('remind me to review the contract', NOW);
    expect(cmd).toMatchObject({ action: 'create', remind: true, due: null });
    expect(cmd?.title).toBe('review the contract');
  });

  it('parses schedule-follow-up as a reminder-backed task', () => {
    const cmd = parseTaskCommand('schedule a follow-up on the invoice tomorrow', NOW);
    expect(cmd).toMatchObject({ action: 'create', remind: true });
    expect(cmd?.title).toBe('Follow up: the invoice');
    expect(cmd?.due).toBe('2026-08-01T09:00:00.000Z');
  });

  it('parses complete (mark … done) with the title fragment', () => {
    const cmd = parseTaskCommand('mark the Q3 deck task as done', NOW);
    expect(cmd).toMatchObject({ action: 'complete' });
    expect(cmd?.title).toBe('Q3 deck');
  });

  it('parses delegate with the worker hint', () => {
    const cmd = parseTaskCommand('delegate the competitor research to the Researcher', NOW);
    expect(cmd).toMatchObject({ action: 'delegate' });
    expect(cmd?.title).toBe('competitor research');
    expect(cmd?.workerHint).toBe('the Researcher');
  });

  it('parses list requests', () => {
    expect(parseTaskCommand('show my open tasks', NOW)?.action).toBe('list');
    expect(parseTaskCommand('what are my overdue tasks?', NOW)?.action).toBe('list');
  });

  it('returns a null title for an empty create (→ clarification, not a guess)', () => {
    const cmd = parseTaskCommand('add a task', NOW);
    expect(cmd?.action).toBe('create');
    expect(cmd?.title).toBeNull();
  });
});

describe('brief / work-summary / meeting-prep resolvers', () => {
  it('resolves brief periods deterministically', () => {
    expect(resolveBriefRequest('plan my day')).toBe('morning');
    expect(resolveBriefRequest('give me the morning briefing')).toBe('morning');
    expect(resolveBriefRequest('summarize overnight activity')).toBe('morning');
    expect(resolveBriefRequest('prepare the weekly report')).toBe('weekly');
    expect(resolveBriefRequest('generate the executive briefing')).toBe('monthly');
    expect(resolveBriefRequest('afternoon update please')).toBe('afternoon');
    expect(resolveBriefRequest('end of day summary')).toBe('evening');
    expect(resolveBriefRequest('what changed since this morning?')).toBeNull();
    expect(resolveBriefRequest('summarize today please')).toBeNull();
  });

  it('resolves work-summary phrasing (and nothing else)', () => {
    expect(resolveWorkSummary('summarize my day')).toBe(true);
    expect(resolveWorkSummary('work summary please')).toBe(true);
    expect(resolveWorkSummary('what did I get done today?')).toBe(true);
    expect(resolveWorkSummary('summarize today please')).toBe(false);
    expect(resolveWorkSummary('explain why sales dropped')).toBe(false);
  });

  it('resolves meeting-prep phrasing (and not agenda drafting)', () => {
    expect(resolveMeetingPrep('prepare me for my next meeting')).toBe(true);
    expect(resolveMeetingPrep('get ready for the 1:1 with Sam')).toBe(true);
    expect(resolveMeetingPrep('brief me before the sync')).toBe(true);
    expect(resolveMeetingPrep('draft an agenda for the meeting tomorrow')).toBe(false);
  });
});

describe('task delegation plan (D-3: worker dispatch stays approval-gated)', () => {
  it('builds the gated worker step for a located worker on a task intent', () => {
    resetPlanStepIds();
    const plan = buildPlan(
      'task',
      'execute',
      'asst_t1',
      { worker: { id: 'w1', name: 'Researcher', role: 'research' } },
      NOW,
    );
    expect(plan).not.toBeNull();
    const step = plan!.steps[0]!;
    expect(step.tool).toBe('worker');
    expect(step.needsApproval).toBe(true);
    expect(step.state).toBe('waiting');
    expect(step.executionKind).toBe('worker');
  });

  it('never offers the dispatch outside side-effect modes (skipped, with the note)', () => {
    resetPlanStepIds();
    const plan = buildPlan(
      'task',
      'ask',
      'asst_t2',
      { worker: { id: 'w1', name: 'Researcher', role: 'research' } },
      NOW,
    );
    expect(plan!.steps[0]!.state).toBe('skipped');
    expect(plan!.steps[0]!.note).toContain('Execute mode');
  });
});
