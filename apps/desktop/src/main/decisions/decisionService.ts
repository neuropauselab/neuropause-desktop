/**
 * Decision service — the deterministic pre-delete assessor and the persistent
 * Decision Record store.
 *
 * The assessor answers ONE question before a delete mutates anything: *does
 * anything real point at this record?* It reads the relationship engine's
 * RESOLVED links (records of links a person or a deterministic match created —
 * never a guess), groups them by relationship, and returns a HIGH RISK
 * assessment with counted evidence and the safer alternative (archive keeps
 * every link intact; soft-delete breaks their targets' resolution).
 *
 * Decision records make the moment reconstructable later: what was asked, what
 * the evidence said, what NeuroPause recommended, what the user chose, what
 * actually executed. Append-only, envelope-persisted, capped.
 *
 * Both halves are Electron-free; instances bind paths and the late-bound
 * relationship store (which initializes after the enterprise subsystem).
 */
import { randomUUID } from 'node:crypto';
import type { ActionAssessment, DecisionEvidence, DecisionRecord } from '@neuropause/shared';
import { AppendOnlyJsonStore } from './appendOnlyStore';

/* ── the assessor ──────────────────────────────────────────────────────────── */

/** The one shape the assessor needs from the relationship store. */
export interface IncomingLink {
  relationshipKey: string;
  /** Human label of the relationship, e.g. 'Customer'. */
  label: string;
  sourceModuleId: string;
  /**
   * The module's human title, e.g. 'Invoices' for `finance-invoices`.
   *
   * Evidence a person is asked to act on has to name things the way they see
   * them on screen. "3 records in finance-invoices" is an internal identifier
   * leaking into a safety decision; falling back to a de-slugged id is better
   * than nothing, but the real title is what the composition root supplies.
   */
  sourceModuleTitle?: string;
}

/**
 * Assess a delete against the record's REAL incoming links.
 *
 * No links → null (the delete proceeds exactly as before this feature).
 * Links → HIGH RISK with per-relationship counts and the archive alternative.
 * The risk grading is a rule, not a judgement call: anything resolved to this
 * record loses its target if the record goes; that is high risk by definition.
 */
export function assessDeleteAgainstLinks(
  recordTitle: string,
  incoming: readonly IncomingLink[],
): ActionAssessment | null {
  if (incoming.length === 0) return null;
  const byLabel = new Map<string, { count: number; modules: Set<string> }>();
  for (const link of incoming) {
    const entry = byLabel.get(link.label) ?? { count: 0, modules: new Set<string>() };
    entry.count += 1;
    entry.modules.add(link.sourceModuleTitle?.trim() || humanizeModuleId(link.sourceModuleId));
    byLabel.set(link.label, entry);
  }
  const evidence: DecisionEvidence[] = [...byLabel.entries()].map(([label, entry]) => ({
    label: `Linked as "${label}"`,
    detail: `${entry.count} record${entry.count === 1 ? '' : 's'} in ${formatList([...entry.modules])} ${entry.count === 1 ? 'resolves' : 'resolve'} to "${recordTitle}"`,
    count: entry.count,
  }));
  return {
    risk: 'high_risk',
    recommendation: `Do not delete. ${incoming.length} record${incoming.length === 1 ? '' : 's'} link to this one and would lose their target. Archive instead — archiving keeps every link intact.`,
    evidence,
    alternative: 'Archive this record (status → archived). Every link keeps resolving; nothing breaks.',
  };
}

/** `finance-invoices` → `Finance invoices`. The fallback, not the goal. */
function humanizeModuleId(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

/** `[a, b, c]` → `a, b and c`. Evidence is read aloud in meetings. */
function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* ── the record store ──────────────────────────────────────────────────────── */

const MAX_RECORDS = 2_000;

export class DecisionRecordStore extends AppendOnlyJsonStore<DecisionRecord> {
  constructor(filePath: string, now: () => string = () => new Date().toISOString()) {
    super(filePath, MAX_RECORDS, now);
  }

  record(input: Omit<DecisionRecord, 'id' | 'at'> & { actor?: string | null }): DecisionRecord {
    const record: DecisionRecord = {
      id: `dec_${randomUUID()}`,
      at: this.now(),
      actor: input.actor ?? null,
      requestedAction: input.requestedAction,
      subject: input.subject,
      assessment: input.assessment,
      outcome: input.outcome,
      executed: input.executed,
      holdId: input.holdId ?? null,
    };
    this.append(record);
    return record;
  }

  get(id: string): DecisionRecord | null {
    return this.items.find((r) => r.id === id) ?? null;
  }

  /**
   * Every decision touching a subject, oldest first — the reconstruction of
   * "why did we do that?" is a sequence, not a single row.
   */
  forSubject(subject: string): DecisionRecord[] {
    return this.items.filter((r) => r.subject === subject);
  }
}
