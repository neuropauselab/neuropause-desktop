/**
 * Sales AI — reviews contacts and conversations and proposes a follow-up
 * message. The pipeline view is read-only (and uses the knowledge graph to relate
 * contacts to their context); the follow-up is a `propose:message` action, which
 * the Governance Runtime always parks for human approval (outbound communication).
 */
import { defineWorker, emptyResult, type SkillImpl, type WorkerDefinition } from '../sdk';
import { buildWorker, byKind, evFromEntities, messageProposal, recentEntities, titles } from './common';

const skills: SkillImpl[] = [
  {
    id: 'pipeline',
    run: (ctx) => {
      const contacts = byKind(ctx.data.entities, ['contact']);
      const convos = byKind(ctx.data.entities, ['conversation', 'message']);
      if (contacts.length === 0 && convos.length === 0) {
        return emptyResult('No contacts or conversations are connected to the pipeline yet.');
      }
      const related = contacts.length > 0 ? ctx.data.neighbors(contacts[0].id).length : 0;
      return {
        summary: `${contacts.length} contact(s), ${convos.length} conversation(s). ${related} related record(s) on the first contact.`,
        evidence: [...evFromEntities(contacts, 6), ...evFromEntities(convos, 6)],
        grounded: true,
        proposals: [],
      };
    },
  },
  {
    id: 'follow-up',
    run: (ctx) => {
      const convos = recentEntities(byKind(ctx.data.entities, ['conversation', 'message']), 3);
      if (convos.length === 0) return emptyResult('No recent conversations to follow up on.');
      const evidence = evFromEntities(convos);
      return {
        summary: `Prepared a follow-up referencing ${convos.length} recent conversation(s).`,
        evidence,
        grounded: true,
        proposals: [
          messageProposal({
            title: 'Send a follow-up message',
            summary: `Follow up on: ${titles(convos)}.`,
            evidence,
            payload: { conversationIds: convos.map((c) => c.id) },
          }),
        ],
      };
    },
  },
];

export function buildSalesWorker(): WorkerDefinition {
  const worker = buildWorker({
    id: 'worker:sales',
    name: 'Sales AI',
    role: 'sales',
    goals: ['Keep deals warm by surfacing follow-ups.', 'Send nothing without human approval.'],
    grants: ['read:entities', 'read:timeline', 'read:graph', 'propose:message'],
    memoryScope: 'team',
    skills: [
      {
        id: 'pipeline',
        title: 'Review pipeline',
        description: 'Summarise contacts and conversations, using the graph for context.',
        sideEffects: false,
        requires: ['read:entities', 'read:graph'],
      },
      {
        id: 'follow-up',
        title: 'Propose a follow-up',
        description: 'Draft a follow-up message from recent conversations (requires approval).',
        sideEffects: true,
        requires: ['read:entities', 'propose:message'],
      },
    ],
  });
  return defineWorker(worker, skills);
}
