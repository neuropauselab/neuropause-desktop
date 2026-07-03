/**
 * Legal AI — identifies documents that read like legal instruments (contracts,
 * agreements, policies, NDAs) and flags those that may be going stale. Read-only:
 * it surfaces what exists and what may need a human's eyes, and never drafts or
 * commits legal positions on its own.
 */
import { defineWorker, emptyResult, type SkillImpl, type WorkerDefinition } from '../sdk';
import { buildWorker, byKind, evFromEntities, matching, recentEntities, titles } from './common';

const LEGAL_RE = /\b(contract|agreement|policy|policies|terms|nda|compliance|license|licence|clause|liability|gdpr|dpa|sow)\b/i;

const skills: SkillImpl[] = [
  {
    id: 'doc-review',
    run: (ctx) => {
      const docs = byKind(ctx.data.entities, ['document', 'file', 'attachment']);
      const legal = matching(docs, LEGAL_RE);
      if (legal.length === 0) return emptyResult('No documents resembling legal instruments are connected yet.');
      const recent = recentEntities(legal, 8);
      return {
        summary: `Found ${legal.length} document(s) that read like legal instruments. Recent: ${titles(recent)}.`,
        evidence: evFromEntities(recent),
        grounded: true,
        proposals: [],
      };
    },
  },
  {
    id: 'stale-flag',
    run: (ctx) => {
      const legal = matching(byKind(ctx.data.entities, ['document', 'file']), LEGAL_RE);
      if (legal.length === 0) return emptyResult('No legal documents to check for staleness.');
      // Oldest-updated first — the ones most likely to need review.
      const stale = [...legal].sort((a, b) => (a.updatedAt > b.updatedAt ? 1 : -1)).slice(0, 5);
      return {
        summary: `${stale.length} legal document(s) have the least recent updates and may warrant review: ${titles(stale)}.`,
        evidence: evFromEntities(stale),
        grounded: true,
        proposals: [],
      };
    },
  },
];

export function buildLegalWorker(): WorkerDefinition {
  const worker = buildWorker({
    id: 'worker:legal',
    name: 'Legal AI',
    role: 'legal',
    goals: ['Surface legal documents from connected data.', 'Flag documents that may need review — never act on them.'],
    grants: ['read:entities', 'read:timeline'],
    memoryScope: 'org',
    skills: [
      {
        id: 'doc-review',
        title: 'Review legal documents',
        description: 'Identify connected documents that read like legal instruments.',
        sideEffects: false,
        requires: ['read:entities'],
      },
      {
        id: 'stale-flag',
        title: 'Flag stale documents',
        description: 'Surface legal documents with the least recent updates for review.',
        sideEffects: false,
        requires: ['read:entities'],
      },
    ],
  });
  return defineWorker(worker, skills);
}
