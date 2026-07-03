/**
 * Founder AI — answers questions about the business and briefs the day, strictly
 * from connected data. It composes the deterministic Founder engine and the
 * briefing generator over the worker's scoped view; both skills are read-only,
 * so they pass governance as low-risk analysis and never produce side effects.
 */
import { answerFounderQuestion } from '../../founder/founderEngine';
import { generateBriefing } from '../../intelligence/briefingGenerator';
import type { BriefingPeriod } from '@neuropause/shared';
import { defineWorker, emptyResult, type SkillImpl, type WorkerDefinition } from '../sdk';
import { buildWorker } from './common';

const PERIODS = new Set<BriefingPeriod>(['morning', 'evening', 'weekly', 'monthly', 'quarterly']);

const skills: SkillImpl[] = [
  {
    id: 'ask',
    run: (ctx, input) => {
      const question = typeof input.question === 'string' && input.question.trim() ? input.question : 'Give me an overview.';
      const ans = answerFounderQuestion(question, {
        entities: ctx.data.entities,
        events: ctx.data.events,
        now: ctx.now,
        neighbors: ctx.data.neighbors,
      });
      return {
        summary: ans.summary,
        evidence: ans.facts.flatMap((f) => f.evidence).map((e) => ({ kind: e.kind, id: e.id })),
        grounded: ans.grounded,
        proposals: [],
      };
    },
  },
  {
    id: 'briefing',
    run: (ctx, input) => {
      const period = (typeof input.period === 'string' && PERIODS.has(input.period as BriefingPeriod)
        ? (input.period as BriefingPeriod)
        : 'morning') as BriefingPeriod;
      const b = generateBriefing(period, { entities: ctx.data.entities, events: ctx.data.events, now: ctx.now });
      if (!b.grounded) return emptyResult('No connected activity to brief on yet.');
      const evidence = b.sections.flatMap((s) => s.items).flatMap((i) => i.evidence).map((e) => ({ kind: e.kind, id: e.id }));
      return { summary: b.headline, evidence: evidence.slice(0, 20), grounded: true, proposals: [] };
    },
  },
];

export function buildFounderWorker(): WorkerDefinition {
  const worker = buildWorker({
    id: 'worker:founder',
    name: 'Founder AI',
    role: 'founder',
    goals: [
      'Give the founder a truthful, evidence-grounded picture of the business.',
      'Separate facts read from connected data from derived suggestions.',
    ],
    grants: ['read:entities', 'read:timeline', 'read:graph'],
    memoryScope: 'org',
    skills: [
      {
        id: 'ask',
        title: 'Answer a question',
        description: 'Answer a question about the business from connected data, citing evidence.',
        sideEffects: false,
        requires: ['read:entities', 'read:timeline', 'read:graph'],
      },
      {
        id: 'briefing',
        title: 'Brief the period',
        description: 'Produce an evidence-grounded briefing for a period (morning/evening/weekly/…).',
        sideEffects: false,
        requires: ['read:entities', 'read:timeline'],
      },
    ],
  });
  return defineWorker(worker, skills);
}
