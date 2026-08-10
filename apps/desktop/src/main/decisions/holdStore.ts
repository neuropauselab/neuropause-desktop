/**
 * The Hold store — NeuroPause's third terminal state, made durable.
 *
 * SUCCESS and FAILURE end a run. HOLD does not: it says "understood, and not
 * safe to execute yet", which is only useful if the item survives the dialog
 * that raised it. The person who hits a hold is frequently not the person who
 * can clear it (they lack the permission, the evidence, or the authority), so
 * an open hold is a durable, listable, resolvable item.
 *
 * A hold is opened from a REFUSED assessment and carries the assessment's own
 * counted evidence — never a restatement of it. Resolving one is an explicit,
 * recorded act, not an implicit side effect of navigating away.
 *
 * Electron-free: the path is injected, so this is fully testable under Node.
 */
import { randomUUID } from 'node:crypto';
import type { HoldOutcome, HoldRecord, HoldView } from '@neuropause/shared';
import { AppendOnlyJsonStore } from './appendOnlyStore';

export interface OpenHoldInput extends HoldView {
  title: string;
  subject: string;
  actor?: string | null;
  decisionId?: string | null;
}

const MAX_HOLDS = 2_000;

export class HoldStore extends AppendOnlyJsonStore<HoldRecord> {
  constructor(filePath: string, now: () => string = () => new Date().toISOString()) {
    super(filePath, MAX_HOLDS, now);
  }

  /**
   * Open a hold — or return the one already open for this subject.
   *
   * Re-raising is deliberate: clicking Delete three times on the same linked
   * customer is one unresolved situation, not three. A duplicate pile would
   * make the Holds list a noise generator, which is exactly how a governance
   * surface stops being read.
   */
  open(input: OpenHoldInput): HoldRecord {
    const existing = this.visible().find((h) => h.status === 'open' && h.subject === input.subject);
    if (existing) return existing;
    const hold: HoldRecord = {
      id: `hold_${randomUUID()}`,
      at: this.now(),
      actor: input.actor ?? null,
      title: input.title,
      subject: input.subject,
      decisionId: input.decisionId ?? null,
      reason: input.reason,
      why: input.why,
      known: input.known,
      unknown: input.unknown,
      resolution: input.resolution,
      ifProceeding: input.ifProceeding,
      status: 'open',
      resolvedAt: null,
      resolvedOutcome: null,
      resolvedNote: null,
    };
    this.append(hold);
    return hold;
  }

  /** Resolve by id. Returns null when unknown or already resolved. */
  resolve(id: string, outcome: HoldOutcome, note: string): HoldRecord | null {
    const hold = this.visible().find((h) => h.id === id);
    if (!hold || hold.status === 'resolved') return null;
    return this.mutate(hold, {
      status: 'resolved',
      resolvedAt: this.now(),
      resolvedOutcome: outcome,
      resolvedNote: note,
    });
  }

  /**
   * Resolve whatever is open for a subject. Used when the action that the hold
   * was about actually happens through another path (a forced delete, or the
   * archive the hold recommended) — the hold must not survive its own answer.
   */
  resolveSubject(subject: string, outcome: HoldOutcome, note: string): HoldRecord | null {
    const hold = this.visible().find((h) => h.status === 'open' && h.subject === subject);
    return hold ? this.resolve(hold.id, outcome, note) : null;
  }

  get(id: string): HoldRecord | null {
    return this.visible().find((h) => h.id === id) ?? null;
  }

  /** Open holds, newest first — the working list. */
  openHolds(): HoldRecord[] {
    return [...this.visible()].reverse().filter((h) => h.status === 'open');
  }

  openCount(): number {
    return this.visible().reduce((n, h) => n + (h.status === 'open' ? 1 : 0), 0);
  }
}
