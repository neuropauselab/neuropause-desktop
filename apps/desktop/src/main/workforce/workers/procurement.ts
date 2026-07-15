/**
 * P8.4 — Procurement worker. Completes the department workforce. Reads the scoped
 * intelligence layer to draft spend/vendor scans and can send a governed vendor
 * outreach message through the existing Microsoft 365 executor. No new runtime —
 * composition over the existing SDK + the P8.3 execution path.
 */
import { composeWorker, draftPair, mailPair } from './common';
import type { WorkerDefinition } from '../sdk';

export function buildProcurementWorker(): WorkerDefinition {
  return composeWorker({
    id: 'worker:procurement',
    name: 'Procurement AI',
    role: 'procurement',
    memoryScope: 'org',
    goals: [
      'Keep spend controlled and vendors managed.',
      'Draft procurement scans and send vendor outreach — gated by human approval.',
    ],
    pairs: [draftPair('spend-scan', 'procurement spend'), mailPair('vendor-outreach', 'Send vendor outreach')],
  });
}
