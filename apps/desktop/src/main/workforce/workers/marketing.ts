/**
 * Marketing AI — reviews connected content (documents and messages) and proposes
 * a marketing update. The review is read-only; the update is a `propose:draft`
 * action gated for human approval. It only ever drafts from material that exists.
 */
import { defineWorker, emptyResult, type SkillImpl, type WorkerDefinition } from '../sdk';
import { buildWorker, byKind, draftProposal, evFromEntities, recentEntities, titles } from './common';

const skills: SkillImpl[] = [
  {
    id: 'content-scan',
    run: (ctx) => {
      const content = byKind(ctx.data.entities, ['document', 'message', 'file']);
      if (content.length === 0) return emptyResult('No content (documents or messages) is connected yet.');
      const recent = recentEntities(content, 8);
      return {
        summary: `Reviewed ${content.length} content item(s). Recent: ${titles(recent)}.`,
        evidence: evFromEntities(recent),
        grounded: true,
        proposals: [],
      };
    },
  },
  {
    id: 'draft-update',
    run: (ctx) => {
      const content = recentEntities(byKind(ctx.data.entities, ['document', 'message']), 5);
      if (content.length === 0) return emptyResult('Nothing to base a marketing update on yet.');
      const evidence = evFromEntities(content);
      return {
        summary: `Prepared a marketing update drawing on ${content.length} item(s).`,
        evidence,
        grounded: true,
        proposals: [
          draftProposal({
            title: 'Draft a marketing update',
            summary: `An update referencing: ${titles(content)}.`,
            evidence,
            payload: { sourceIds: content.map((c) => c.id) },
          }),
        ],
      };
    },
  },
];

export function buildMarketingWorker(): WorkerDefinition {
  const worker = buildWorker({
    id: 'worker:marketing',
    name: 'Marketing AI',
    role: 'marketing',
    goals: ['Turn connected content into draft updates.', 'Never publish without human approval.'],
    grants: ['read:entities', 'read:timeline', 'propose:draft'],
    memoryScope: 'team',
    skills: [
      {
        id: 'content-scan',
        title: 'Scan content',
        description: 'Review connected documents and messages as marketing material.',
        sideEffects: false,
        requires: ['read:entities'],
      },
      {
        id: 'draft-update',
        title: 'Propose an update',
        description: 'Draft a marketing update from recent content (requires approval).',
        sideEffects: true,
        requires: ['read:entities', 'propose:draft'],
      },
    ],
  });
  return defineWorker(worker, skills);
}
