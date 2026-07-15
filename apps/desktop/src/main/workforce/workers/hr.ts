/**
 * P8.4 — People / HR worker. Completes the department workforce (Engineering,
 * Marketing, Sales, Finance, Operations, Support, Legal already ship as built-in
 * workers). Reads the scoped intelligence layer to draft people-ops digests and
 * can send a governed onboarding message through the existing Microsoft 365
 * executor. No new runtime — composition over the existing SDK + P8.3 path.
 */
import { composeWorker, draftPair, mailPair } from './common';
import type { WorkerDefinition } from '../sdk';

export function buildHrWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:hr',
    name: 'People & HR AI',
    role: 'hr',
    memoryScope: 'org',
    goals: [
      'Keep people operations moving.',
      'Draft people digests and send onboarding messages — gated by human approval.',
    ],
    pairs: [draftPair('people-digest', 'people operations'), mailPair('send-onboarding', 'Send an onboarding message')],
  });
}
