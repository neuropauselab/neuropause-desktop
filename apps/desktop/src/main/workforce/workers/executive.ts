/**
 * P8.4 — Executive workforce. Eight C-suite archetypes that reason over the
 * Enterprise Graph, Memory, and Timeline to produce governed strategic drafts,
 * notes, and (for a few) a real Microsoft 365 action. Every worker shares the
 * `executive` role (a coarse tier); the specific office — CEO, CTO, CFO … — is
 * the individual worker, carried in its name + goals. None of these introduce a
 * runtime: they compose the existing SDK helpers and the P8.3 execution path.
 */
import { composeWorker, draftPair, mailPair, notePair } from './common';
import type { WorkerDefinition } from '../sdk';

export function buildCeoWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:exec-ceo',
    name: 'CEO — Chief Executive',
    role: 'executive',
    memoryScope: 'org',
    goals: [
      'Keep the company aligned on strategy and priorities.',
      'Draft executive briefings and all-hands communications — gated by human approval.',
    ],
    pairs: [draftPair('strategy-briefing', 'strategy'), mailPair('all-hands', 'Send an all-hands message')],
  });
}

export function buildCooWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:exec-coo',
    name: 'COO — Chief Operating Officer',
    role: 'executive',
    memoryScope: 'org',
    goals: [
      'Keep operations executing against the plan.',
      'Draft operating reviews and record operational-risk notes for follow-through.',
    ],
    pairs: [draftPair('operations-review', 'operations'), notePair('escalation-note', 'operational risk')],
  });
}

export function buildCtoWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:exec-cto',
    name: 'CTO — Chief Technology Officer',
    role: 'executive',
    memoryScope: 'org',
    goals: [
      'Set and communicate the technology strategy.',
      'Draft technology strategy briefs and capture architecture decisions.',
    ],
    pairs: [draftPair('tech-strategy', 'technology strategy'), notePair('architecture-note', 'architecture')],
  });
}

export function buildCfoWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:exec-cfo',
    name: 'CFO — Chief Financial Officer',
    role: 'executive',
    memoryScope: 'org',
    goals: [
      'Keep spend and financial posture under control.',
      'Draft spend reviews and record budget notes — gated by human approval.',
    ],
    pairs: [draftPair('spend-review', 'spend'), notePair('budget-note', 'budget')],
  });
}

export function buildCioWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:exec-cio',
    name: 'CIO — Chief Information Officer',
    role: 'executive',
    memoryScope: 'org',
    goals: [
      'Keep enterprise systems coherent and well-governed.',
      'Draft systems reviews and survey the vendor/application estate.',
    ],
    pairs: [draftPair('systems-review', 'systems'), notePair('vendor-note', 'vendor estate')],
  });
}

export function buildCisoWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:exec-ciso',
    name: 'CISO — Chief Information Security Officer',
    role: 'executive',
    memoryScope: 'org',
    goals: [
      'Keep the enterprise security posture understood and communicated.',
      'Draft security-risk reviews and issue security advisories — gated by human approval.',
    ],
    pairs: [draftPair('risk-review', 'security risk'), mailPair('security-advisory', 'Send a security advisory')],
  });
}

export function buildCdoWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:exec-cdo',
    name: 'Chief Data Officer',
    role: 'executive',
    memoryScope: 'org',
    goals: [
      'Keep the enterprise data estate governed and trustworthy.',
      'Draft data reviews and record data-governance notes.',
    ],
    pairs: [draftPair('data-review', 'data'), notePair('data-note', 'data governance')],
  });
}

export function buildCcoWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:exec-cco',
    name: 'Chief Compliance Officer',
    role: 'executive',
    memoryScope: 'org',
    goals: [
      'Keep the enterprise aligned with policy and regulation.',
      'Draft compliance reviews and issue compliance notices — gated by human approval.',
    ],
    pairs: [draftPair('compliance-review', 'compliance'), mailPair('compliance-notice', 'Send a compliance notice')],
  });
}
