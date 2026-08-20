/**
 * S34a — the queryable Action Record (closes F-4). A durable, tenant-scoped,
 * append-only evidence record of what happened to each consequential action, so
 * "what happened to the email I sent?" is answerable WITHOUT reading raw logs.
 *
 * `observe` is a BEST-EFFORT OBSERVER (FG-5): it is called after the governed
 * send has fully resolved, it NEVER throws and NEVER blocks/alters the send, and
 * a failed emit logs an evidence gap rather than being swallowed. All logic lives
 * here (non-frozen); the frozen send path contributes exactly one gated line.
 *
 * Condition 3 (no second copy of content): the record carries the CHAIN
 * (ids, actor VERBATIM in the D-12 namespace, tenant, connector, account,
 * recipients, verdict, outcome) plus subject/body FINGERPRINTS (non-reversible)
 * and a REFERENCE to the admission (transitionId) — never a second copy of
 * subject/body.
 */
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { GovernedSendResult } from '../cst/sendTransition';
import { readStoreFile, envelopeStamp } from '../storage/storeEnvelope';
import { declareStoreScope } from '../tenancy/storeScope';
import { createLogger } from '../logger';

const log = createLogger('action-record');
const FILE = 'action-records.json';

// S34a — the action record is customer-derived governance evidence, per tenant.
declareStoreScope({
  name: 'action-records',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  // Append-only audit: no cap, no eviction, no delete path — a governance record
  // is never silently evicted, and nothing here can reach another tenant's rows.
  retentionScope: 'NONE',
  retentionAuthority: 'NONE',
  retention:
    'Append-only. `observe` appends one record; there is no cap, TTL, eviction or delete path, so a ' +
    'write can remove nothing — least of all another tenant\'s record. Growth is bounded operationally ' +
    '(backup/retention), never by silently dropping audit evidence.',
  reason:
    'WHY TENANT: each record names a tenant\'s consequential action (recipients + outcome) and is stamped ' +
    'with the send\'s tenantId; `query` filters by tenantId so no cross-tenant read is possible. WHAT DATA: ' +
    'the evidence chain (ids, actor, connector, account, recipients, verdict, outcome) + subject/body ' +
    'FINGERPRINTS (non-reversible) + a reference to the admission — never a second copy of content. ' +
    'CROSS-TENANT COST: none — reads are tenant-filtered; nothing is removed.',
});

/**
 * NP-014 / RULE-012 ("verification evidence must have provenance",
 * ARCHITECTURE-SPEC §53): a verification terminal now names WHO observed it
 * and HOW — the caller that ran the oracle, the corroboration method, and the
 * oracle identity. Optional so no historical record is invalidated (a record
 * written before this field existed is honest about lacking it — never
 * back-filled); the PRODUCTION caller supplying it is pinned in
 * `constitutionalInvariants.test.ts`.
 */
export interface ActionRecordVerificationProvenance {
  /** Which runner performed the read-back (e.g. 's16VerifyRun'). */
  readonly source: string;
  /** The corroboration method (never id-alone; the oracle's matching rule). */
  readonly method: string;
  /** The oracle identity (e.g. 'm365ReadBack:sentItems+inbox'). */
  readonly oracle: string;
}

export interface ActionRecordVerification {
  readonly terminal: string;
  readonly internetMessageId: string | null;
  /** `verification_time` (§14) — when the ORACLE RAN. Never the effect's time. */
  readonly at: string;
  readonly provenance?: ActionRecordVerificationProvenance;
  /**
   * NP-015 — `effect_time` (§14): when the PROVIDER says the external effect
   * occurred, verbatim from the corroborated read-back row. Optional AND
   * nullable, and the distinction is deliberate: ABSENT = written before this
   * field existed (never back-filled); NULL = this verification ran and the
   * oracle supplied no effect time (a HOLD, a bounce, or a reader that does
   * not report one). Never our clock, never inferred from `at`.
   */
  readonly effectTime?: string | null;
}

export interface ActionRecord {
  readonly id: string;
  /** `record_time` (§14) — when THIS ROW WAS WRITTEN. Never the effect's time. */
  readonly at: string;
  readonly requestId: string;
  readonly transitionId: string;
  /**
   * NP-015 — `request_time` (§14): when the governed REQUEST was stamped by
   * the transition kernel, READ (never re-clocked) from the requestId the
   * kernel minted — `req:<idem>:<stamp>`. Null when that stamp is absent or
   * is not a parseable instant (a legacy id, or a caller whose clock port
   * returns a non-ISO value): the observer states what it was told, and says
   * nothing where it was told nothing.
   */
  readonly requestTime?: string | null;
  /**
   * NP-015 — `event_time` (§14): when the real-world event that OCCASIONED
   * this action occurred — deliberately distinct from request_time, because
   * "A happened before B" is not "A caused B" (§14). Supplied by a caller that
   * genuinely observed such an event; **null on today's only production path**
   * (the governed send carries no upstream event stamp — an operator's confirm
   * is not timestamped into the payload). Present-and-null is the honest
   * state: the concept is modeled, the value is absent, and nothing fabricates
   * one from the request or the clock.
   */
  readonly eventTime?: string | null;
  /** The governed actor VERBATIM (D-12 namespace, e.g. `local:<id>`), never stripped. */
  readonly actor: string;
  readonly tenantId: string;
  readonly connectorId: string;
  readonly accountId: string;
  readonly actionId: string;
  readonly recipients: { readonly to: string[]; readonly cc: string[]; readonly bcc: string[] };
  /** Non-reversible fingerprint — NOT the subject/body. */
  readonly subjectFingerprint: string;
  readonly bodyFingerprint: string;
  readonly verdict: string;
  readonly executed: boolean;
  readonly outcome: string;
  /** A REFERENCE to the admission evidence, not a copy. */
  readonly admissionRef: string;
  verification: ActionRecordVerification | null;
}

export interface ActionRecordQuery {
  readonly tenantId: string;
  readonly requestId?: string;
  readonly transitionId?: string;
  readonly recipient?: string;
  readonly subjectFingerprint?: string;
}

interface ExecuteRequestLike {
  connectorId: string;
  accountId: string;
  actionId: string;
  params?: Record<string, unknown>;
}

interface ObserveContext {
  readonly actor: string;
  readonly tenantId: string;
  /**
   * NP-015 — `event_time` (§14), supplied ONLY by a caller that genuinely
   * observed the occasioning event. Omitted by the governed send path (which
   * has none), so the record honestly stores null.
   */
  readonly eventTime?: string | null;
}

interface Persisted {
  schemaVersion?: number;
  records: ActionRecord[];
}

function fingerprint(text: unknown): string {
  const norm = typeof text === 'string' ? text.toLowerCase().replace(/\s+/g, ' ').trim() : '';
  return norm === '' ? '' : createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

/**
 * NP-015 — `request_time` (§14), READ out of the kernel-minted requestId
 * (`req:<idem>:<stamp>`). Deliberately strict: it accepts ONLY a trailing
 * ISO-8601 instant that also parses, anchored at the end (the ISO stamp
 * carries its own colons, and `idem` may carry colons too, so neither a
 * left- nor a right-split is safe). Anything else — a legacy id, an epoch
 * clock port, a truncated id — yields NULL rather than a guess. This reads a
 * value the kernel really stamped; it never re-clocks and never approximates.
 */
export function requestTimeFrom(requestId: string): string | null {
  const m = /:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))$/.exec(requestId);
  if (!m) return null;
  return Number.isFinite(Date.parse(m[1])) ? m[1] : null;
}

/** Normalize a recipient field that may be a string[], a comma string, or absent. */
function recipientList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter((x) => x !== '');
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter((x) => x !== '');
  return [];
}

/** Read a string field off the governed outcome without assuming its exact shape. */
function outcomeString(outcome: unknown, key: string): string {
  if (outcome && typeof outcome === 'object' && key in outcome) {
    const v = (outcome as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
  }
  return '';
}
function outcomeBool(outcome: unknown, key: string): boolean {
  return !!(outcome && typeof outcome === 'object' && (outcome as Record<string, unknown>)[key] === true);
}

class ActionRecordStore {
  private records: ActionRecord[] = [];
  private loaded = false;
  private dirOverride: string | null = null;

  /** Test seam — point the store at a temp dir (no app dependency). */
  useDirForTests(dir: string): void {
    this.dirOverride = dir;
    this.loaded = false;
    this.records = [];
  }

  private path(): string {
    return join(this.dirOverride ?? app.getPath('userData'), FILE);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const read = await readStoreFile<Persisted>(this.path());
    this.records = read.state === 'loaded' && read.data && Array.isArray(read.data.records) ? read.data.records : [];
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify({ ...envelopeStamp(), records: this.records }, null, 2);
    const p = this.path();
    const tmp = `${p}.tmp`;
    await fs.writeFile(tmp, payload, 'utf8');
    await fs.rename(tmp, p);
  }

  /**
   * BEST-EFFORT observer. Records the evidence chain for a resolved governed send.
   * NEVER throws, NEVER blocks the send; a failure logs an evidence gap.
   */
  async observe(request: ExecuteRequestLike, result: GovernedSendResult, ctx: ObserveContext): Promise<void> {
    let transitionId = '';
    try {
      const outcome = (result as unknown as { outcome?: unknown }).outcome;
      transitionId = outcomeString(outcome, 'transitionId');
      const requestId = outcomeString(outcome, 'requestId');
      const params = request.params ?? {};
      const record: ActionRecord = {
        id: `act_${randomUUID()}`,
        at: new Date().toISOString(), // record_time — this row's write
        requestId,
        // NP-015 §14: read from the kernel's own stamp; null when unstamped.
        requestTime: requestTimeFrom(requestId),
        // NP-015 §14: only a caller that OBSERVED an event supplies one.
        eventTime: ctx.eventTime ?? null,
        transitionId,
        actor: ctx.actor, // verbatim — never stripped (D-12)
        tenantId: ctx.tenantId,
        connectorId: request.connectorId,
        accountId: request.accountId,
        actionId: request.actionId,
        recipients: {
          to: recipientList(params.to),
          cc: recipientList(params.cc),
          bcc: recipientList(params.bcc),
        },
        subjectFingerprint: fingerprint(params.subject),
        bodyFingerprint: fingerprint(params.body),
        verdict: outcomeString(outcome, 'verdict'),
        executed: outcomeBool(outcome, 'executed'),
        outcome: result.semanticOutcome,
        admissionRef: transitionId,
        verification: null,
      };
      await this.ensureLoaded();
      this.records.push(record);
      await this.persist();
    } catch (err) {
      // Honest about its own failure — an evidence gap, never a silent swallow,
      // and never propagated to the send path.
      log.warn(
        `[ACTION_RECORD] emit failed — evidence gap for ${transitionId || 'unknown'}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Attach a verification terminal to the record of a prior send. Best-effort. */
  async recordVerification(transitionId: string, terminal: ActionRecordVerification): Promise<void> {
    try {
      await this.ensureLoaded();
      const rec = this.records.find((r) => r.transitionId === transitionId);
      if (!rec) {
        log.warn(`[ACTION_RECORD] verification for unknown transition ${transitionId} — evidence gap`);
        return;
      }
      rec.verification = terminal;
      await this.persist();
    } catch (err) {
      log.warn(`[ACTION_RECORD] verification emit failed for ${transitionId}`, err instanceof Error ? err.message : String(err));
    }
  }

  /** Answer "what happened to …?" — tenant-filtered (no cross-tenant read). */
  async query(filter: ActionRecordQuery): Promise<ActionRecord[]> {
    await this.ensureLoaded();
    return this.records.filter(
      (r) =>
        r.tenantId === filter.tenantId &&
        (filter.requestId === undefined || r.requestId === filter.requestId) &&
        (filter.transitionId === undefined || r.transitionId === filter.transitionId) &&
        (filter.subjectFingerprint === undefined || r.subjectFingerprint === filter.subjectFingerprint) &&
        (filter.recipient === undefined ||
          r.recipients.to.includes(filter.recipient) ||
          r.recipients.cc.includes(filter.recipient) ||
          r.recipients.bcc.includes(filter.recipient)),
    );
  }
}

export const actionRecord = new ActionRecordStore();
