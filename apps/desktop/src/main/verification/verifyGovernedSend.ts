/**
 * NeuroPause OS — Wave 2 / S5.4 Phase 0. The DE-GATED, READ-ONLY read-back orchestrator for a governed mail.send.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────────────────
 * The S16 read-back oracle (`verifyEffect`) is pure, and the READ-ONLY Graph reader (`m365ReadBack`) already ships.
 * What was still trapped inside the compile-stripped e2e machinery (`e2e/s16VerifyRun.ts`) was the ORCHESTRATION —
 * "build the verification target from what the send left behind, then run the oracle over the reader". But that
 * orchestration is READ-ONLY and carries no e2e/latch identity, so it is production-safe. This module is that core,
 * de-gated: latch-free, env-free, electron-free. The S16 runner and the e2e verify runner both DELEGATE here; the
 * only thing that stays compile-stripped is each caller's TRIGGER (latch read / env flag / mock reader), never the
 * read-back logic itself. `verify-e2e-strip.sh` keeps its meaning: this file MUST ship; the triggers MUST NOT.
 *
 * ── READ-ONLY (constitutional §2 #14 — universal read-back) ──────────────────────────────────────────────────
 * Executor-success is never the claim. This orchestrator NEVER sends and NEVER mutates: it only drives the reader's
 * `readSentItems` / `readInbox` through `verifyEffect`, which independently decides the terminal truth
 * (VERIFIED_SUCCESS | VERIFY_FAILED) or holds (HOLD, never auto-promoted). The reader is injected so the caller owns
 * all I/O and identity — this module has none.
 */
import {
  verifyEffect,
  fingerprint,
  type VerificationTarget,
  type VerifyResult,
  type SentItem,
  type InboxItem,
} from './verifyEffect';

/** What a completed governed send left behind — the corroboration inputs, never any callable or token. */
export interface GovernedSendRef {
  readonly recipient: string;
  readonly subject: string;
  /** Body text used ONLY to derive a comparison fingerprint. It is never re-sent. Empty ⇒ body is not corroborated. */
  readonly body: string;
  /** Centre of the legacy point±half-width window. Ignored when `sentAtWindow` is supplied. */
  readonly sentAtMs: number;
  /** The 202 carries no id; when a later stage learns one it may be passed, but it is never sufficient ALONE. */
  readonly internetMessageId?: string | null;
  /** Half-width of the timestamp corroboration window (ms). Default 10 min, matching the in-session runner. */
  readonly windowMs?: number;
  /**
   * D1 (operator ruling, 21 Aug 2026) — THE INTERVAL FORM. An explicit `[fromMs, toMs]` bounded by two REAL
   * MEASURED INSTANTS, supplied instead of a centre and a radius.
   *
   * WHY IT IS NOT AN NP-019 VIOLATION, AND WHY IT IS NOT AN FG-12 ONE EITHER — this is the whole ruling:
   * NP-019 refused `authorization_time` and `execution_time` because they were POINT claims with NO source.
   * This is an INTERVAL claim with TWO sources. **`requestTime` is used here as A BOUND THAT EXECUTION
   * PROVABLY EXCEEDS — never as a proxy for execution time.** The send cannot have happened before the request
   * that caused it was constructed, and cannot have happened after the row observing its result was written.
   * Neither endpoint is a guess, and the interval is NEVER collapsed to a point.
   *
   * If either endpoint is unavailable the caller must yield UNKNOWN — never widen to infinity, never narrow to
   * a guess. Width is bounded (`maxWidthMs`); exceeding the bound yields UNKNOWN, never VERIFIED.
   */
  readonly sentAtWindow?: { readonly fromMs: number; readonly toMs: number };
  /** D2 — subject limb in the RECORD-FINGERPRINT codomain, for a caller driven from the evidence store. */
  readonly subjectMatchKey?: string;
  /** D1 — maximum permitted interval width (ms). Exceeding it yields UNKNOWN → HOLD. */
  readonly maxWidthMs?: number;
  /** Two rows matching one tuple ⇒ UNKNOWN → HOLD rather than first-match. */
  readonly requireUniqueMatch?: boolean;
}

/** The READ-ONLY reader the orchestrator drives. Exactly the shape `makeM365GraphReader` returns. */
export interface ReadBackReader {
  readSentItems: () => Promise<readonly SentItem[]>;
  readInbox: () => Promise<readonly InboxItem[]>;
}

export interface VerifyClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_WINDOW_MS = 10 * 60_000;

/**
 * Project a send ref into the oracle's corroboration target. The id is carried only if present (and even then the
 * oracle requires recipient + subject + timestamp to ALSO agree — id is never proof on its own).
 */
export function buildVerificationTarget(ref: GovernedSendRef): VerificationTarget {
  const half = ref.windowMs ?? DEFAULT_WINDOW_MS;
  // D1 — the INTERVAL form wins when supplied; otherwise the legacy centre±half-width, byte-for-byte as before.
  const sentAtWindow = ref.sentAtWindow ?? { fromMs: ref.sentAtMs - half, toMs: ref.sentAtMs + half };
  return {
    internetMessageId: ref.internetMessageId ?? null,
    recipient: ref.recipient,
    subjectFingerprint: fingerprint(ref.subject),
    bodyFingerprint: fingerprint(ref.body),
    sentAtWindow,
    ...(ref.subjectMatchKey !== undefined ? { subjectMatchKey: ref.subjectMatchKey } : {}),
    ...(ref.maxWidthMs !== undefined ? { maxWidthMs: ref.maxWidthMs } : {}),
    ...(ref.requireUniqueMatch !== undefined ? { requireUniqueMatch: ref.requireUniqueMatch } : {}),
  };
}

/**
 * Run the read-back over the injected reader. Pure orchestration over the pure oracle: same ref + same reader
 * outputs ⇒ same terminal. `prior` gives idempotency (a recorded TERMINAL is returned without re-polling).
 */
export async function verifyGovernedSend(
  ref: GovernedSendRef,
  reader: ReadBackReader,
  clock: VerifyClock,
  opts?: { readonly backoffMs?: readonly number[]; readonly prior?: VerifyResult },
): Promise<VerifyResult> {
  const target = buildVerificationTarget(ref);
  return verifyEffect(
    target,
    {
      readSentItems: reader.readSentItems,
      readInbox: reader.readInbox,
      now: clock.now,
      sleep: clock.sleep,
      backoffMs: opts?.backoffMs,
    },
    opts?.prior,
  );
}
