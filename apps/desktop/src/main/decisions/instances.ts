/**
 * Decision subsystem singletons + the late-bound link reader.
 *
 * The relationship store initializes with the Data Plane, AFTER the enterprise
 * subsystem that needs the assessor — so the link reader is late-bound. Note
 * the failure mode this shape has: an UNBOUND reader reports "no links", which
 * reads as "safe to delete". The composition root therefore binds it
 * unconditionally at boot (see `runtimeCore`), and `bindingIsLive()` lets the
 * governance surface state plainly whether dependency assessment is active
 * rather than implying a clean bill of health it cannot give.
 */
import { app } from 'electron';
import { join } from 'node:path';
import { DecisionRecordStore, type IncomingLink } from './decisionService';
import { HoldStore } from './holdStore';

export const decisionRecordStore = new DecisionRecordStore(
  join(app.getPath('userData'), 'decision-records.json'),
);

export const holdStore = new HoldStore(join(app.getPath('userData'), 'holds.json'));

let linkReader: ((recordId: string) => IncomingLink[]) | null = null;

/** Bind the real relationship-store reader once the Data Plane exists. */
export function bindIncomingLinkReader(reader: (recordId: string) => IncomingLink[]): void {
  linkReader = reader;
}

/** True once dependency assessment is reading real links. */
export function bindingIsLive(): boolean {
  return linkReader !== null;
}

export function incomingLinksFor(recordId: string): IncomingLink[] {
  if (!linkReader) return [];
  try {
    return linkReader(recordId);
  } catch {
    return [];
  }
}
