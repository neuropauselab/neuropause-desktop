/**
 * Research AI — scans connected documents, files, and notes, and proposes a
 * research digest. The scan is read-only; the digest is a `propose:draft`
 * action, so the Governance Runtime parks it for human approval before anything
 * is written. Everything it proposes is grounded in the documents it found.
 */
import { defineWorker, emptyResult, type SkillImpl, type WorkerDefinition } from '../sdk';
import { buildWorker, byKind, draftProposal, evFromEntities, recentEntities, titles } from './common';

const skills: SkillImpl[] = [
  {
    id: 'scan',
    run: (ctx) => {
      const docs = byKind(ctx.data.entities, ['document', 'file', 'attachment']);
      if (docs.length === 0) return emptyResult('No documents or files are connected to research yet.');
      const recent = recentEntities(docs, 8);
      return {
        summary: `Found ${docs.length} document(s)/file(s). Most recent: ${titles(recent)}.`,
        evidence: evFromEntities(recent),
        grounded: true,
        proposals: [],
      };
    },
  },
  {
    id: 'digest',
    run: (ctx) => {
      const docs = recentEntities(byKind(ctx.data.entities, ['document', 'file']), 6);
      if (docs.length === 0) return emptyResult('Nothing to digest — no documents are connected.');
      const evidence = evFromEntities(docs);
      return {
        summary: `Prepared a research digest covering ${docs.length} document(s).`,
        evidence,
        grounded: true,
        proposals: [
          draftProposal({
            title: 'Draft a research digest',
            summary: `A digest summarising: ${titles(docs)}.`,
            evidence,
            payload: { documentIds: docs.map((d) => d.id) },
          }),
        ],
      };
    },
  },
];

export function buildResearchWorker(): WorkerDefinition {
  const worker = buildWorker({
    id: 'worker:research',
    name: 'Research AI',
    role: 'research',
    goals: ['Surface what the connected documents say.', 'Propose digests that a human approves before sharing.'],
    grants: ['read:entities', 'read:timeline', 'read:memory', 'propose:draft'],
    memoryScope: 'team',
    skills: [
      {
        id: 'scan',
        title: 'Scan documents',
        description: 'Summarise connected documents, files, and attachments.',
        sideEffects: false,
        requires: ['read:entities'],
      },
      {
        id: 'digest',
        title: 'Propose a digest',
        description: 'Draft a research digest from recent documents (requires approval).',
        sideEffects: true,
        requires: ['read:entities', 'propose:draft'],
      },
    ],
  });
  return defineWorker(worker, skills);
}
