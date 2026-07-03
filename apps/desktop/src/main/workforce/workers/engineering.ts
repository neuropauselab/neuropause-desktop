/**
 * Engineering AI — triages open work using the deterministic recommendation
 * engine (stale and blocked tasks) and summarises recent engineering activity.
 * Both skills are read-only analysis; the value is an evidence-cited view of
 * what needs attention, not autonomous action.
 */
import { generateRecommendations } from '../../recommendations/recommendationEngine';
import { defineWorker, emptyResult, type SkillImpl, type WorkerDefinition } from '../sdk';
import { buildWorker, evFromEvents, openTasks } from './common';

const ATTENTION_KINDS = new Set(['stale_task', 'blocked_project', 'upcoming_deadline', 'pending_document', 'unanswered']);

const skills: SkillImpl[] = [
  {
    id: 'triage',
    run: (ctx) => {
      const recs = generateRecommendations({ entities: ctx.data.entities, events: ctx.data.events, now: ctx.now });
      const attention = recs.filter((r) => ATTENTION_KINDS.has(r.kind));
      const pick = (attention.length > 0 ? attention : recs).slice(0, 6);
      if (pick.length === 0) {
        const open = openTasks(ctx.data.entities).length;
        return emptyResult(open === 0 ? 'No open tasks are connected to triage.' : 'No tasks currently need attention.');
      }
      return {
        summary: `${pick.length} item(s) need attention: ${pick.map((r) => r.title).join('; ')}.`,
        evidence: pick.flatMap((r) => r.evidence).map((e) => ({ kind: e.kind, id: e.id })),
        grounded: true,
        proposals: [],
      };
    },
  },
  {
    id: 'standup',
    run: (ctx) => {
      const events = ctx.data.events.slice(0, 20);
      if (events.length === 0) return emptyResult('No recent activity recorded to summarise.');
      const open = openTasks(ctx.data.entities).length;
      return {
        summary: `${events.length} recent activity event(s); ${open} open task(s) in flight.`,
        evidence: evFromEvents(events),
        grounded: true,
        proposals: [],
      };
    },
  },
];

export function buildEngineeringWorker(): WorkerDefinition {
  const worker = buildWorker({
    id: 'worker:engineering',
    name: 'Engineering AI',
    role: 'engineering',
    goals: ['Keep open work moving by surfacing stale and blocked tasks.', 'Summarise recent engineering activity.'],
    grants: ['read:entities', 'read:timeline'],
    memoryScope: 'team',
    skills: [
      {
        id: 'triage',
        title: 'Triage open work',
        description: 'Surface stale and blocked tasks that need attention.',
        sideEffects: false,
        requires: ['read:entities', 'read:timeline'],
      },
      {
        id: 'standup',
        title: 'Summarise activity',
        description: 'Summarise recent engineering activity and work in flight.',
        sideEffects: false,
        requires: ['read:entities', 'read:timeline'],
      },
    ],
  });
  return defineWorker(worker, skills);
}
