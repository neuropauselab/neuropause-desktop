/**
 * Support AI — surfaces conversations, messages, and notifications that may need
 * a response, and proposes a reply. The inbox review is read-only; the reply is a
 * `propose:message` action, always parked by governance for human approval before
 * anything is sent. Replies are grounded in the conversation they answer.
 */
import { defineWorker, emptyResult, type SkillImpl, type WorkerDefinition } from '../sdk';
import { buildWorker, byKind, evFromEntities, messageProposal, recentEntities, titles } from './common';

const skills: SkillImpl[] = [
  {
    id: 'inbox',
    run: (ctx) => {
      const inbox = byKind(ctx.data.entities, ['conversation', 'message', 'notification']);
      if (inbox.length === 0) return emptyResult('No conversations, messages, or notifications are connected yet.');
      const recent = recentEntities(inbox, 8);
      return {
        summary: `${inbox.length} item(s) in the connected inbox may need attention. Recent: ${titles(recent)}.`,
        evidence: evFromEntities(recent),
        grounded: true,
        proposals: [],
      };
    },
  },
  {
    id: 'reply',
    run: (ctx) => {
      const threads = recentEntities(byKind(ctx.data.entities, ['conversation', 'message']), 3);
      if (threads.length === 0) return emptyResult('No conversations to reply to.');
      const evidence = evFromEntities(threads);
      return {
        summary: `Prepared a reply grounded in ${threads.length} recent thread(s).`,
        evidence,
        grounded: true,
        proposals: [
          messageProposal({
            title: 'Send a support reply',
            summary: `Reply addressing: ${titles(threads)}.`,
            evidence,
            payload: { threadIds: threads.map((t) => t.id) },
          }),
        ],
      };
    },
  },
];

export function buildSupportWorker(): WorkerDefinition {
  const worker = buildWorker({
    id: 'worker:support',
    name: 'Support AI',
    role: 'support',
    goals: ['Surface conversations that need a response.', 'Draft replies for human approval before sending.'],
    grants: ['read:entities', 'read:timeline', 'read:memory', 'propose:message'],
    memoryScope: 'team',
    skills: [
      {
        id: 'inbox',
        title: 'Review the inbox',
        description: 'Surface conversations, messages, and notifications that may need a response.',
        sideEffects: false,
        requires: ['read:entities'],
      },
      {
        id: 'reply',
        title: 'Propose a reply',
        description: 'Draft a support reply grounded in a conversation (requires approval).',
        sideEffects: true,
        requires: ['read:entities', 'propose:message'],
      },
    ],
  });
  return defineWorker(worker, skills);
}
