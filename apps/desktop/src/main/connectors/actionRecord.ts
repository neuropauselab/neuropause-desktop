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
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { GovernedSendResult } from '../cst/sendTransition';
// D2 (operator ruling, 21 Aug 2026) — the RECORD-FINGERPRINT rule moved to ONE named authority so a
// read-back reconciler can hash what it OBSERVES with the identical rule instead of copying it. The
// unchanged pins over the persisted file (`actionRecord.test.ts:86-87,92-94`) are the byte-equivalence proof.
import { recordFingerprint } from '../evidence/recordFingerprint';
// D-16 consumer-side classification authority. PURE — no store, no Electron, no reach into
// governance or execution, so it does not weaken the OBSERVER invariant pinned at actionRecord.test.ts:204.
import { classifyTerminal } from '../verification/verificationTerminals';
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

/**
 * ROUTE A (F-P24) — the EXECUTION-class marker for a row whose execution never started.
 *
 * ONE definition, imported by every reader, because a second copy is how the counter and the store drift apart
 * (F-N16-1: a third copy was refused). It is a value of the existing `outcome` field, deliberately NOT a new
 * column: no schema change, and rows written before Route A are untouched and unreclassified.
 */
export const EXECUTION_NOT_STARTED = 'NOT_STARTED';

/** A governance decision that produced no execution. `NOT_EVALUATED` is NOT a refusal — see `observeGovernance`. */
export type GovernanceVerdict = 'DENY' | 'NOT_EVALUATED';

/** The minimum a governance row needs. Narrower than `ExecuteRequestLike`: there is no result to describe. */
export interface GovernanceObserveRequest {
  readonly connectorId: string;
  readonly accountId: string;
  readonly actionId: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ActionRecord {
  readonly id: string;
  /**
   * FG-14 (F-P40) — the ORIGINATING CAUSAL EPISODE identity (`asst_<uuid>`), stored VERBATIM.
   *
   * ANSWERS: "which causal episode produced this evidence?" — and nothing else. It is NOT
   * authority, NOT consent, NOT proof of execution, NOT proof of verification. It is distinct from
   * every other id on this row and must never be derived from or substituted by them:
   *   `requestId`    = the concrete EXECUTION REQUEST (`req:<idem>:<mint-instant>`)
   *   `transitionId` = `m365-send:<idem>` — CONTENT-addressed, collides across causally distinct runs
   *   `admissionRef` = the same value as `transitionId`
   * Two runs with identical parameters share `idem`/`transitionId` by design; `correlationId` is
   * what keeps them separable as evidence.
   *
   * OPTIONAL, and absence is meaningful: a record written before FG-14, or one whose send did not
   * originate from an assistant episode (manual composition, dev propose), carries no causal
   * identity. That means CAUSAL IDENTITY UNAVAILABLE — never "no episode existed", and never a
   * licence to fabricate one or fall back to another id.
   */
  readonly correlationId?: string;
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
  /**
   * FG-14 — the ORIGINATING CAUSAL EPISODE identity, read from the execute request the observer
   * already receives. The CST kernel is deliberately NOT on this path: correlation is EVIDENCE, so
   * it travels request -> evidence and never enters governance, `idem`, or `requestId`.
   */
  correlationId?: string;
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

/**
 * D2 — this was a PRIVATE `fingerprint` whose name collided with the oracle's MATCH-KEY function of the
 * same name and a different codomain (the eighth naming collision, ARCHITECTURE-MAPPING §5.0). The rule
 * itself is unchanged and now lives in `evidence/recordFingerprint.ts`; this alias keeps the two call
 * sites below reading naturally while there is exactly ONE definition in the repository.
 */
const fingerprint = recordFingerprint;

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
  const iso = /:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))$/.exec(requestId);
  if (iso) return Number.isFinite(Date.parse(iso[1])) ? iso[1] : null;
  /**
   * FG-12 §15 — the SECOND mint format. The production kernel clock returns
   * EPOCH MILLISECONDS, so a real id ends `:<digits>`; that epoch is the
   * request-construction instant — the one thing the frozen logical clock
   * truthfully measured (NP-019). Read verbatim, converted only in
   * representation, never re-clocked.
   *
   * Conservative by construction: digits ONLY, anchored at the end, and inside
   * a plausible range. A counter (`:1`), a seconds-precision stamp, a
   * truncated id, or a far-future number is NOT a request time — it yields
   * null, never a guess.
   */
  const epoch = /:(\d{10,15})$/.exec(requestId);
  if (!epoch) return null;
  const ms = Number(epoch[1]);
  if (!Number.isFinite(ms) || ms < EPOCH_FLOOR_MS || ms > EPOCH_CEILING_MS) return null;
  return new Date(ms).toISOString();
}

/** 2001-09-09 — below this an epoch-ms value is implausible (or is seconds). */
const EPOCH_FLOOR_MS = 1_000_000_000_000;
/** 2286-11-20 — above this a 13-digit ms value is out of any plausible range. */
const EPOCH_CEILING_MS = 9_999_999_999_999;

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
   * ROUTE A (F-P24) — BEST-EFFORT **GOVERNANCE-CLASS** observer: a decision that produced NO EXECUTION.
   *
   * §2 #19 keeps GOVERNANCE, EXECUTION and VERIFICATION as separate evidence classes and forbids collapsing one
   * into another. This row is `governance = <verdict> · execution = NOT_STARTED · verification = NOT_APPLICABLE`,
   * and **a governance DENY is NEVER converted into `execution_failed`** — nothing was attempted.
   *
   * ── A SKIP IS NOT A REFUSAL ──────────────────────────────────────────────────────────────────────────────────
   * `NOT_EVALUATED` exists because F-P48's finding is that the gate **did not decide**: the lookup missed and the
   * send proceeded. Recording that as `DENY` would assert a refusal that never happened and make an **ungated send
   * look governed** — worse than the present silence, because silence is at least honestly empty. This row's
   * purpose is to make **the ABSENCE of a decision** visible, never to invent one. The two cases are separated by
   * the `verdict` FIELD, never by prose in a message.
   *
   * `transitionId` and `admissionRef` are `''` — the **established** absent representation in this store (see
   * `observe`, which defaults the same way when an outcome carries none), not a new one and not a minted id. A
   * refusal never reaches the CST, so no transition exists; fabricating one would create a second id-space.
   */
  async observeGovernance(
    request: GovernanceObserveRequest,
    verdict: GovernanceVerdict,
    ctx: ObserveContext,
  ): Promise<void> {
    try {
      const params = request.params ?? {};
      const record: ActionRecord = {
        id: `act_${randomUUID()}`,
        at: new Date().toISOString(), // record_time — this row's write
        requestId: '', // no execution request was ever minted
        requestTime: null, // NP-015: a time we were not told is ABSENT, never approximated
        eventTime: ctx.eventTime ?? null,
        transitionId: '', // no transition exists — the established absent form, never minted
        actor: ctx.actor, // verbatim (D-12)
        tenantId: ctx.tenantId, // WORKSPACE id, per F-P45 — the key the writer writes
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
        verdict,
        executed: false,
        outcome: EXECUTION_NOT_STARTED,
        admissionRef: '',
        verification: null,
      };
      await this.ensureLoaded();
      this.records.push(record);
      await this.persist();
    } catch (err) {
      log.warn(
        `[ACTION_RECORD] governance emit failed — evidence gap for ${request.actionId} (${verdict})`,
        err instanceof Error ? err.message : String(err),
      );
    }
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
      /**
       * FG-12 — the requestId is surfaced on the RESULT, not the outcome: the
       * kernel's envelope never carried it, which is why this stored `''` and
       * request_time was structurally null (F-N19-2). The outcome is still read
       * as a fallback so a caller predating the field behaves exactly as before.
       */
      const requestId = outcomeString(result, 'requestId') || outcomeString(outcome, 'requestId');
      const params = request.params ?? {};
      const record: ActionRecord = {
        id: `act_${randomUUID()}`,
        // FG-14 — verbatim from the request. No transform, no hash, no default, no fallback.
        ...(typeof request.correlationId === 'string' && request.correlationId.length > 0
          ? { correlationId: request.correlationId }
          : {}),
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

  /**
   * Attach a verification terminal to the record of a prior send. Best-effort — never throws.
   *
   * ── D3 · MONOTONICITY (operator ruling, 21 Aug 2026) ───────────────────────────────────────────────────────
   * **AN OBSERVATION FAILURE DOWNGRADES CERTAINTY, NEVER THE RECORDED TERMINAL.** A `VERIFIED_SUCCESS` is a fact
   * about the world — the message was corroborated in Sent Items. A later read that fails to find it is a
   * FAILURE TO OBSERVE, not a change in the fact. Before this rule, line 347 was an unconditional overwrite, so
   * a transient Graph hiccup on a reconciler re-run silently rewrote a corroborated success to `HOLD`, with no
   * history and no log. UNRESOLVED → settled is the whole point of reconciliation and is allowed; settled →
   * anything is REFUSED and logged.
   *
   * Settled→settled (a late NDR arriving after a corroborated send) is ALSO refused, deliberately: it is a
   * genuinely different question — D-16's `VERIFIED_SUCCESS` is send-corroboration, never delivery — and
   * resolving it needs its own ruling. **No policy is invented here.** This matches the oracle's own contract
   * (`verifyEffect.ts:125-127` returns a prior terminal without re-polling).
   *
   * ── D3 · TENANT ISOLATION ──────────────────────────────────────────────────────────────────────────────────
   * `tenantId` is REQUIRED and matched. Before it, this was the one method on the singleton with no tenant
   * argument, and `.find()` scanned every tenant's rows — a confused-deputy surface (S32 class). The mechanism
   * that made it reachable rather than theoretical: `transitionId` is CONTENT-ADDRESSED
   * (`m365-send:<sha256(tenant|connector|account|action|params)>`, `cst/sendTransition.ts:165-169,212`), so it
   * COLLIDES BY CONSTRUCTION for two sends with identical parameters. Tenant is inside that hash, so a
   * cross-tenant collision needs equal tenants — but isolation rested entirely on that hash input rather than on
   * any code here, and an evidence layer must not depend on a hash's contents for its access control.
   */
  async recordVerification(
    tenantId: string,
    transitionId: string,
    terminal: ActionRecordVerification,
  ): Promise<void> {
    try {
      await this.ensureLoaded();
      const rec = this.records.find((r) => r.tenantId === tenantId && r.transitionId === transitionId);
      if (!rec) {
        log.warn(`[ACTION_RECORD] verification for unknown transition ${transitionId} — evidence gap`);
        return;
      }
      const settled = rec.verification != null && classifyTerminal(rec.verification.terminal) !== 'unresolved';
      if (settled) {
        // Never silent: the refusal is itself evidence that a re-read disagreed with a settled fact.
        log.warn(
          `[ACTION_RECORD] MONOTONICITY — refusing to replace settled terminal ${rec.verification?.terminal} with ${terminal.terminal} for ${transitionId}`,
        );
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
