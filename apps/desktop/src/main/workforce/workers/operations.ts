/**
 * Operations AI — briefs the operation, recommends next actions, and can propose
 * a reminder for a stale or blocked task or a memory note capturing an
 * observation. The briefing and recommendations are read-only; the reminder and
 * note are side-effecting `write:*` proposals, gated by governance (a new worker
 * is below the write-trust floor, so they require approval until it earns trust;
 * an imminent-deadline reminder is high-risk and always requires approval).
 */
import { generateBriefing } from '../../intelligence/briefingGenerator';
import { generateRecommendations } from '../../recommendations/recommendationEngine';
import { defineWorker, emptyResult, type SkillImpl, type WorkerDefinition } from '../sdk';
import { buildWorker, ev, memoryProposal, openTasks, reminderProposal } from './common';

const STALE_KINDS = new Set(['stale_task', 'blocked_project', 'pending_document', 'upcoming_deadline']);

const skills: SkillImpl[] = [
  {
    id: 'briefing',
    run: (ctx) => {
      const b = generateBriefing('morning', { entities: ctx.data.entities, events: ctx.data.events, now: ctx.now });
      if (!b.grounded) return emptyResult('No connected activity to brief on yet.');
      const evidence = b.sections.flatMap((s) => s.items).flatMap((i) => i.evidence).map((e) => ({ kind: e.kind, id: e.id }));
      return { summary: b.headline, evidence: evidence.slice(0, 20), grounded: true, proposals: [] };
    },
  },
  {
    id: 'recommend',
    run: (ctx) => {
      const recs = generateRecommendations({ entities: ctx.data.entities, events: ctx.data.events, now: ctx.now }).slice(0, 6);
      if (recs.length === 0) return emptyResult('Nothing recommended right now — no open work needs attention.');
      return {
        summary: `${recs.length} recommended next action(s): ${recs.map((r) => r.title).join('; ')}.`,
        evidence: recs.flatMap((r) => r.evidence).map((e) => ({ kind: e.kind, id: e.id })),
        grounded: true,
        proposals: [],
      };
    },
  },
  {
    id: 'remind',
    run: (ctx) => {
      const recs = generateRecommendations({ entities: ctx.data.entities, events: ctx.data.events, now: ctx.now });
      const target = recs.find((r) => STALE_KINDS.has(r.kind));
      if (!target) return emptyResult('No stale or blocked work to set a reminder for.');
      const highRisk = target.kind === 'upcoming_deadline';
      return {
        summary: `Prepared a reminder for: ${target.title}.`,
        evidence: target.evidence.map((e) => ({ kind: e.kind, id: e.id })),
        grounded: true,
        proposals: [
          reminderProposal({
            title: `Set a reminder: ${target.title}`,
            summary: target.rationale,
            evidence: target.evidence.map((e) => ({ kind: e.kind, id: e.id })),
            payload: { entityRefs: target.entityRefs, recommendationId: target.id },
            risk: highRisk ? 'high' : 'low',
          }),
        ],
      };
    },
  },
  {
    id: 'note',
    run: (ctx) => {
      const open = openTasks(ctx.data.entities);
      if (open.length === 0) return emptyResult('Nothing notable to record — no open tasks.');
      const evidence = open.slice(0, 5).map((t) => ev(t.kind, t.id));
      return {
        summary: `Prepared an operational note covering ${open.length} open task(s).`,
        evidence,
        grounded: true,
        proposals: [
          memoryProposal({
            title: 'Record an operational note',
            summary: `${open.length} open task(s) currently in flight.`,
            evidence,
            payload: { openTaskIds: open.slice(0, 20).map((t) => t.id) },
          }),
        ],
      };
    },
  },
];

export function buildOperationsWorker(): WorkerDefinition {
  const worker = buildWorker({
    id: 'worker:operations',
    name: 'Operations AI',
    role: 'operations',
    goals: [
      'Keep the operation briefed and moving.',
      'Propose reminders and notes for follow-through — gated by human approval.',
    ],
    grants: ['read:entities', 'read:timeline', 'write:memory', 'write:reminder'],
    memoryScope: 'org',
    skills: [
      {
        id: 'briefing',
        title: 'Brief the operation',
        description: 'Produce an evidence-grounded operational briefing.',
        sideEffects: false,
        requires: ['read:entities', 'read:timeline'],
      },
      {
        id: 'recommend',
        title: 'Recommend next actions',
        description: 'Surface the highest-value next actions from connected work.',
        sideEffects: false,
        requires: ['read:entities', 'read:timeline'],
      },
      {
        id: 'remind',
        title: 'Propose a reminder',
        description: 'Propose a reminder for stale or blocked work (requires approval).',
        sideEffects: true,
        requires: ['read:entities', 'write:reminder'],
      },
      {
        id: 'note',
        title: 'Record a note',
        description: 'Propose a memory note capturing an operational observation (requires approval).',
        sideEffects: true,
        requires: ['read:entities', 'write:memory'],
      },
    ],
  });
  return defineWorker(worker, skills);
}
