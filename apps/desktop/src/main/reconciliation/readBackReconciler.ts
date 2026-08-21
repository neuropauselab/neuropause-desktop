/**
 * NeuroPause OS — THE READ-BACK RECONCILER. The production caller F-P39 said did not exist.
 *
 * ── WHAT F-P39 WAS ───────────────────────────────────────────────────────────────────────────────────────────
 * `verifyGovernedSend` shipped, `verifyEffect` shipped, `m365ReadBack` shipped — and NOTHING IN A RELEASE BUILD
 * EVER CALLED THEM. The only importers were two `__NP_E2E__`-gated modules that `verify-e2e-strip.sh` removes
 * from `out/`. So the product carried a verification layer that could not run: step 6 of the ceremony did not
 * exist in the artifact a user installs, `m365WriteStates.EXTERNALLY_OBSERVED` was pinned to 0 by construction
 * (F-P41), and CLAUDE §2 #19's corollary applied verbatim — *a verification class with no production caller is
 * not a separate evidence class, it is an absent one.* This module is that caller.
 *
 * ── WHAT IT DOES, AND WHERE IT STOPS ─────────────────────────────────────────────────────────────────────────
 *   READ the evidence store → CLASSIFY → RECORD the terminal → STOP.
 *
 * **HOLD IS TERMINAL HERE (operator ruling G).** Resolving a HOLD is a separate slice. There is no promotion
 * path in this file, no retry-to-success loop, and no branch that turns a HOLD into anything else — the
 * structure, not a convention, is what guarantees §2 #9's *UNRESOLVED remains unresolved*.
 *
 * **IT NEVER EXECUTES.** No send, no resend, no retry-with-effect. That is why ruling H dissolved the missing
 * resend policy: *a missing policy only blocks if the thing being built needs it.* (The absence is recorded in
 * the envelope for whatever eventually does need it. Nothing was invented.)
 *
 * **IT GRANTS NOTHING.** It produces VERIFICATION-class evidence only, never GOVERNANCE and never EXECUTION
 * (§2 #19 — the three classes must not collapse). A reader failure is UNKNOWN, never `execution_failed`. And a
 * recorded VERIFIED_SUCCESS is evidence for a future proposal, NEVER permission (§2 #15).
 *
 * ── PURE BY CONSTRUCTION ─────────────────────────────────────────────────────────────────────────────────────
 * Electron-free, store-free, clock-free: every capability arrives through `ReconcilerDeps`. This is deliberate
 * and is the fix for the defect the existing callers carry — `s16VerifyRun.ts:50` and `e2eVerifyRun.ts:34` both
 * HARD-WIRE their reader construction, which is exactly why `makeM365GraphReader` has never been executed by a
 * test. Copying that shape would have inherited the untestability.
 */
import { verifyGovernedSend, type ReadBackReader } from '../verification/verifyGovernedSend';
import type { VerifyResult } from '../verification/verifyEffect';

/**
 * D1 — THE WIDTH BOUND. 120 s.
 *
 * Derived from the transport, not chosen for feel: the effect's own hard ceiling is `REQUEST_TIMEOUT_MS = 60_000`
 * (`unified/sync/http.ts:113`, via `AbortSignal.timeout`), so a legitimate send cannot spend more than ~60 s
 * between the request being constructed and the result being observed. 120 s is 2× that headroom.
 *
 * What it EXCLUDES is the point. `RateLimiter.acquire` sleeps BEFORE `fetch` on a provider-supplied `Retry-After`
 * that has **no ceiling** and is shared across every M365 write action on the account (`rateLimiter.ts:54-61`,
 * `http.ts:86-92`). A single `Retry-After: 86400` puts a legitimately-minted `requestTime` HOURS before its own
 * `at`. Without this bound that six-hour window would "corroborate" any message sent that day, and the interval
 * would become a laundered guess. Exceeding it yields UNKNOWN → HOLD. Never VERIFIED.
 */
export const MAX_CORROBORATION_WIDTH_MS = 120_000;

/** The subset of an ActionRecord this module reads. Structural, so the real store satisfies it. */
export interface ReconcilableRecord {
  readonly transitionId: string;
  readonly tenantId: string;
  readonly connectorId: string;
  readonly accountId: string;
  readonly actionId: string;
  readonly outcome: string;
  readonly at: string;
  readonly requestTime?: string | null;
  readonly subjectFingerprint: string;
  readonly recipients: { readonly to: string[]; readonly cc: string[]; readonly bcc: string[] };
  readonly verification: unknown | null;
}

export interface ReconcilerDeps {
  query: (filter: { tenantId: string }) => Promise<readonly ReconcilableRecord[]>;
  recordVerification: (
    tenantId: string,
    transitionId: string,
    terminal: {
      terminal: string;
      internetMessageId: string | null;
      at: string;
      provenance: { source: string; method: string; oracle: string };
      effectTime: string | null;
    },
  ) => Promise<void>;
  /**
   * Supplied by the composition root, which owns all I/O and identity. Null ⇒ no reader, which is UNKNOWN.
   *
   * Keyed on the RECORD, not the tenant: the reader authenticates as ONE account (`m365ReadBack.ts:33`
   * `connectorVault.get(workspaceId, connectorId, accountId)`), and one tenant can hold several. A per-tenant
   * reader would read account A's Sent Items looking for account B's message and honestly find nothing —
   * a false HOLD produced by the reconciler's own wiring rather than by the world.
   */
  readerFor: (record: ReconcilableRecord) => ReadBackReader | null;
  /** The composition root names the reader it injected. The reconciler never guesses an oracle identity. */
  oracleId: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** Why a record could not be turned into a corroboration target. Each is an honest UNKNOWN, never a silent skip. */
export type UnreconcilableReason =
  | 'NO_REQUEST_TIME'
  | 'UNPARSEABLE_INTERVAL'
  | 'INTERVAL_TOO_WIDE'
  | 'NO_SUBJECT_EVIDENCE'
  | 'RECIPIENT_NOT_REPRESENTABLE';

export type RefBuild =
  | { readonly ok: true; readonly ref: Parameters<typeof verifyGovernedSend>[0]; readonly widthMs: number }
  | { readonly ok: false; readonly reason: UnreconcilableReason; readonly detail: string };

/**
 * Project a stored record into a corroboration target — or refuse, with a named reason.
 *
 * THE INTERVAL (D1): `requestTime ≤ effect ≤ at`, both endpoints real measured instants carried on the record.
 * `requestTime` is the kernel's request-construction instant (FG-12, read verbatim from the minted requestId);
 * `at` is the observer's own row-write instant. The send cannot precede the request that caused it, and cannot
 * follow the row that observed its result. **It is never collapsed to a point.**
 *
 * THE SUBJECT LIMB (D2): the record holds a RECORD-FINGERPRINT (one-way sha256-16) and no subject text — that
 * one-wayness is deliberate and pinned. So the limb is carried as `subjectMatchKey` and evaluated by hashing the
 * OBSERVED subject with the identical rule. The record is not weakened to make a match possible.
 *
 * THE BODY LIMB: honestly absent. The record stores only a body RECORD-FINGERPRINT, and the oracle's body rule
 * is prefix-over-plaintext, so there is nothing comparable to supply. `body: ''` is the truthful input, and the
 * limb is vacuous exactly as it already is on the only path that ever ran against real Graph.
 */
export function buildReconcileRef(record: ReconcilableRecord): RefBuild {
  if (record.requestTime == null || record.requestTime === '') {
    return {
      ok: false,
      reason: 'NO_REQUEST_TIME',
      detail: 'record carries no request_time — the interval has no lower bound (never widened to infinity)',
    };
  }
  const fromMs = Date.parse(record.requestTime);
  const toMs = Date.parse(record.at);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return {
      ok: false,
      reason: 'UNPARSEABLE_INTERVAL',
      detail: `interval endpoints did not parse into an ordered pair (from=${record.requestTime} to=${record.at})`,
    };
  }
  const widthMs = toMs - fromMs;
  if (widthMs > MAX_CORROBORATION_WIDTH_MS) {
    return {
      ok: false,
      reason: 'INTERVAL_TOO_WIDE',
      detail: `interval is ${widthMs}ms wide, bound is ${MAX_CORROBORATION_WIDTH_MS}ms — a window too wide to identify one message is never VERIFIED`,
    };
  }
  if (record.subjectFingerprint === '') {
    return {
      ok: false,
      reason: 'NO_SUBJECT_EVIDENCE',
      detail: 'record carries no subject fingerprint — the subject limb cannot be evaluated, so the tuple cannot corroborate',
    };
  }
  // The oracle requires EXACTLY ONE `to` recipient and reads no cc/bcc, so anything else has no representable
  // target. Refused by name rather than silently reconciled against a partial tuple.
  const to = record.recipients.to;
  if (to.length !== 1 || record.recipients.cc.length > 0 || record.recipients.bcc.length > 0) {
    return {
      ok: false,
      reason: 'RECIPIENT_NOT_REPRESENTABLE',
      detail: `oracle corroborates exactly one recipient; record has to=${to.length} cc=${record.recipients.cc.length} bcc=${record.recipients.bcc.length}`,
    };
  }
  return {
    ok: true,
    widthMs,
    ref: {
      recipient: to[0],
      subject: '', // unused — `subjectMatchKey` carries the limb (D2)
      body: '', // honestly absent; the body limb is vacuous, as it already is on the only real-Graph path
      sentAtMs: fromMs, // ignored: `sentAtWindow` takes precedence. Present only to satisfy the legacy field.
      sentAtWindow: { fromMs, toMs },
      subjectMatchKey: record.subjectFingerprint,
      maxWidthMs: MAX_CORROBORATION_WIDTH_MS,
      requireUniqueMatch: true,
      windowMs: undefined,
      internetMessageId: null,
    },
  };
}

/** Is this record awaiting verification? ACKNOWLEDGED means submitted, never verified (`sendTransition.ts:69`). */
export function awaitingVerification(r: ReconcilableRecord): boolean {
  return r.actionId === 'mail.send' && r.outcome === 'ACKNOWLEDGED' && r.verification == null;
}

export interface ReconcilePassSummary {
  readonly tenantId: string;
  readonly considered: number;
  readonly attempted: number;
  readonly recorded: number;
  readonly refused: number;
  readonly skippedInFlight: number;
}

/**
 * SINGLE-FLIGHT, KEYED ON THE HOLD — NOT ON THE TENANT (mandatory build 1).
 *
 * The host provides no lock at any layer: all three background drivers are `void`-ed fire-and-forget, so a pass
 * exceeding the 60 s tick OVERLAPS ITSELF. S22's "no hold is lost or double-resolved" is therefore NOT inherited
 * and has to be built here. It is keyed on the hold because a tenant-grain lock would serialize unrelated holds
 * and STILL permit one hold to be resolved twice across ticks — the exact property being protected.
 *
 * Second callers COALESCE onto the in-flight promise rather than starting a second probe, following the proven
 * precedent at `unified/sync/orchestrator.ts:273-276`.
 */
const inFlight = new Map<string, Promise<VerifyResult | null>>();

/** Test seam — assert the map does not leak between passes. Never called in production. */
export function inFlightSizeForTests(): number {
  return inFlight.size;
}

async function singleFlight(key: string, run: () => Promise<VerifyResult | null>): Promise<VerifyResult | null> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = (async () => run())().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

/**
 * One reconciliation pass for ONE tenant. Called inside that tenant's principal by the fan-out, so every read
 * beneath it is already tenant-scoped; `tenantId` is passed explicitly as well because the evidence store must
 * not depend on ambient state for isolation (D3).
 *
 * Never throws: a reconciler that can fail a background tick is a reconciler that stops running.
 */
export async function reconcileTenant(tenantId: string, deps: ReconcilerDeps): Promise<ReconcilePassSummary> {
  let attempted = 0;
  let recorded = 0;
  let refused = 0;
  let skippedInFlight = 0;
  let considered = 0;

  let records: readonly ReconcilableRecord[] = [];
  try {
    records = await deps.query({ tenantId });
  } catch {
    return { tenantId, considered: 0, attempted: 0, recorded: 0, refused: 0, skippedInFlight: 0 };
  }

  const pending = records.filter(awaitingVerification);
  considered = pending.length;

  for (const record of pending) {
    const reader = deps.readerFor(record);
    const built = buildReconcileRef(record);
    if (!built.ok) {
      // An unreconcilable record is UNKNOWN, and UNKNOWN is recorded — not skipped. A silent skip would leave
      // the row indistinguishable from one nothing ever looked at (§2 #19: observable is not recorded).
      refused += 1;
      await safeRecord(deps, tenantId, record, 'HOLD', null, null, `not reconcilable: ${built.reason} — ${built.detail}`);
      continue;
    }
    if (!reader) {
      refused += 1;
      await safeRecord(deps, tenantId, record, 'HOLD', null, null, 'no read-back reader available for this tenant — UNKNOWN, never assumed delivered');
      continue;
    }
    if (inFlight.has(record.transitionId)) {
      skippedInFlight += 1;
      continue;
    }
    attempted += 1;
    const result = await singleFlight(record.transitionId, async () => {
      try {
        return await verifyGovernedSend(
          built.ref,
          reader,
          { now: deps.now, sleep: deps.sleep },
          // ONE read per record per pass. The 60 s tick IS the retry schedule, so an in-pass backoff would
          // sleep a background job for ~37 s per record to no benefit.
          { backoffMs: [0] },
        );
      } catch {
        return null; // a reader failure is UNKNOWN — never execution_failed (§2 #19)
      }
    });
    if (result == null) {
      await safeRecord(deps, tenantId, record, 'HOLD', null, null, 'read-back failed — UNKNOWN, held for reconciliation (a failure to observe is not a failure to send)');
      continue;
    }
    await safeRecord(deps, tenantId, record, result.state, result.matchedMessageId, result.observedEffectAt, result.detail);
    recorded += 1;
  }
  return { tenantId, considered, attempted, recorded, refused, skippedInFlight };
}

async function safeRecord(
  deps: ReconcilerDeps,
  tenantId: string,
  record: ReconcilableRecord,
  terminal: string,
  internetMessageId: string | null,
  effectTime: string | null,
  method: string,
): Promise<void> {
  try {
    await deps.recordVerification(tenantId, record.transitionId, {
      terminal,
      internetMessageId,
      at: new Date(deps.now()).toISOString(), // verification_time — when THIS oracle ran
      provenance: { source: 'readBackReconciler', method, oracle: deps.oracleId },
      effectTime,
    });
  } catch {
    // Best-effort, exactly like the observer: an evidence-write failure must never stop the pass.
  }
}
