/**
 * Finance AI — surfaces finance-related records from connected data. It is
 * deliberately read-only: acting on finances is high-stakes, and this worker will
 * not fabricate transactions or figures. When nothing finance-related is
 * connected, it says so plainly rather than inventing a result.
 */
import { defineWorker, emptyResult, type SkillImpl, type WorkerDefinition } from '../sdk';
import { buildWorker, byKind, evFromEntities, matching, recentEntities, titles } from './common';

const FINANCE_RE = /\b(invoice|payment|budget|expense|expenses|spend|cost|revenue|finance|financial|billing|receipt|payroll|subscription)\b/i;

const skills: SkillImpl[] = [
  {
    id: 'spend-scan',
    run: (ctx) => {
      const candidates = byKind(ctx.data.entities, ['document', 'file', 'message', 'label']);
      const finance = matching(candidates, FINANCE_RE);
      if (finance.length === 0) return emptyResult('No finance-related records are connected yet.');
      const recent = recentEntities(finance, 8);
      return {
        summary: `Found ${finance.length} finance-related record(s). Recent: ${titles(recent)}.`,
        evidence: evFromEntities(recent),
        grounded: true,
        proposals: [],
      };
    },
  },
  {
    id: 'summary',
    run: (ctx) => {
      const finance = matching(ctx.data.entities, FINANCE_RE);
      if (finance.length === 0) return emptyResult('No finance signals in the connected data to summarise.');
      return {
        summary: `Tracking ${finance.length} finance-related record(s) across the connected data.`,
        evidence: evFromEntities(finance),
        grounded: true,
        proposals: [],
      };
    },
  },
];

export function buildFinanceWorker(): WorkerDefinition {
  const worker = buildWorker({
    id: 'worker:finance',
    name: 'Finance AI',
    role: 'finance',
    goals: ['Surface finance-related records from connected data.', 'Never fabricate financial figures or actions.'],
    grants: ['read:entities', 'read:timeline'],
    memoryScope: 'org',
    skills: [
      {
        id: 'spend-scan',
        title: 'Scan for finance records',
        description: 'Find finance-related documents, messages, and labels in connected data.',
        sideEffects: false,
        requires: ['read:entities'],
      },
      {
        id: 'summary',
        title: 'Summarise finance signals',
        description: 'Summarise finance-related records across the connected data.',
        sideEffects: false,
        requires: ['read:entities'],
      },
    ],
  });
  return defineWorker(worker, skills);
}
