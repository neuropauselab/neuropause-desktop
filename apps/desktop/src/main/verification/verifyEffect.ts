/**
 * NeuroPause OS — Wave 2 / Slice 16. Read-back verification oracle for a governed mail.send.
 *
 * After the certified path returns ACKNOWLEDGED (Graph 202 — which carries NO message id), the effect is UNVERIFIED:
 * "accepted for delivery" is not "delivered". This oracle independently reads the mailbox back and decides the truth.
 *
 * State machine (VERIFICATION § of CLAUDE.md — uncertainty is never success):
 *   EXECUTED_ACK → VERIFY_PENDING → VERIFIED_SUCCESS | VERIFY_FAILED ; and the uncertain branch VERIFY_PENDING →
 *   UNKNOWN → HOLD. Terminal = VERIFIED_SUCCESS | VERIFY_FAILED. HOLD (UNRESOLVED) NEVER auto-promotes to SUCCESS.
 *
 * Match (Slice-15 condition 7): internetMessageId + recipient + subject/body fingerprint + timestamp window —
 * CORROBORATED, never the id alone. The oracle is PURE over an injectable Graph reader + clock (testable, mock-proven);
 * it runs in the app's main process during the operator's live session, where the vault token unlocks (DECISIONS D-10).
 */

import { recordFingerprint } from '../evidence/recordFingerprint';

export type VerifyState =
  | 'EXECUTED_ACK'
  | 'VERIFY_PENDING'
  | 'VERIFIED_SUCCESS'
  | 'VERIFY_FAILED'
  | 'UNKNOWN'
  | 'HOLD';

/** The identifying tuple the send left behind. `internetMessageId` may be null (202 has no body). */
export interface VerificationTarget {
  readonly internetMessageId: string | null;
  readonly recipient: string;
  /** MATCH-KEY form (normalized plaintext). Used unless `subjectMatchKey` is supplied. */
  readonly subjectFingerprint: string;
  readonly bodyFingerprint: string;
  readonly sentAtWindow: { readonly fromMs: number; readonly toMs: number };
  /**
   * D2 (operator ruling, 21 Aug 2026) — the subject limb in the RECORD-FINGERPRINT codomain.
   *
   * A caller driven from the EVIDENCE STORE has no raw subject: `ActionRecord` deliberately persists a one-way
   * `sha256(normalized).slice(0,16)` and nothing else, so the file on disk carries no subject text (pinned).
   * Feeding that hash into `subjectFingerprint` would compare a hash against normalized plaintext and be false
   * for every real subject — silently, forever. So such a caller supplies THIS field instead, and the limb is
   * evaluated by hashing the OBSERVED subject with the identical rule.
   *
   * NEITHER SIDE IS WEAKENED: the record still stores no plaintext, and the oracle still compares like with like.
   * ABSENT ⇒ the plaintext limb is used exactly as before, so every pre-existing caller is unaffected.
   */
  readonly subjectMatchKey?: string;
  /**
   * D1 (operator ruling, 21 Aug 2026) — THE WIDTH BOUND. Maximum permitted width of `sentAtWindow`, in ms.
   *
   * A corroboration window is only evidence while it is TIGHT. An interval derived from two measured instants is
   * honest, but its width is not guaranteed: the M365 transport can stall a send arbitrarily before the request
   * ever leaves (`rateLimiter.ts:54-61` sleeps BEFORE `fetch` on a provider-supplied `Retry-After` that has no
   * ceiling, shared across every write action on the account). Without a bound, a six-hour window would
   * "corroborate" any message sent that day — and the interval becomes a laundered guess.
   *
   * Exceeding it yields UNKNOWN → HOLD, **never VERIFIED**. ABSENT ⇒ unbounded, preserving existing behaviour.
   */
  readonly maxWidthMs?: number;
  /** When true, two or more matching rows yield UNKNOWN → HOLD instead of the first match. See `verifyEffect`. */
  readonly requireUniqueMatch?: boolean;
}

/** A Sent Items row (the subset the oracle reads). */
export interface SentItem {
  readonly internetMessageId: string | null;
  readonly toRecipients: readonly string[];
  readonly subject: string;
  readonly bodyPreview: string;
  readonly sentDateTime: string;
}

/** An Inbox row, scanned for a bounce/NDR. */
export interface InboxItem {
  readonly from: string;
  readonly subject: string;
  readonly bodyPreview: string;
  readonly receivedDateTime: string;
}

export interface VerifyDeps {
  readSentItems: () => Promise<readonly SentItem[]>;
  readInbox: () => Promise<readonly InboxItem[]>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Bounded backoff schedule (ms between polls). Default is a short, finite ramp; exhausting it → UNKNOWN → HOLD. */
  backoffMs?: readonly number[];
}

export interface VerifyResult {
  readonly state: VerifyState; // terminal (VERIFIED_SUCCESS | VERIFY_FAILED) or HOLD
  readonly matchedMessageId: string | null;
  readonly bounceReason: string | null;
  readonly attempts: number;
  readonly detail: string;
  /**
   * NP-015 — `effect_time` (ARCHITECTURE-SPEC §14): WHEN THE PROVIDER SAYS THE
   * EFFECT OCCURRED, carried out VERBATIM from the corroborated Sent Items row
   * (`SentItem.sentDateTime`). Null on every non-corroborated path — a bounce,
   * a HOLD, or any state where no provider row was matched. It is NEVER our
   * clock, never the verification time, never inferred from the window: an
   * effect time we were not TOLD is absent, not approximated. Carrying it out
   * changes no matching, no schedule, no read — the row was already found.
   */
  readonly observedEffectAt: string | null;
}

const DEFAULT_BACKOFF = [0, 2000, 5000, 10000, 20000] as const;

/** Deterministic fingerprint: lower-cased, whitespace-collapsed, trimmed. Comparable across the send and the read-back. */
export function fingerprint(text: string): string {
  return (typeof text === 'string' ? text : '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Does this Sent Items row corroborate the target? Requires recipient AND subject AND timestamp-window to ALL agree,
 * plus the id if the target has one. NEVER the id alone — the id, on its own, is not proof (condition 7).
 */
export function matchesTuple(item: SentItem, t: VerificationTarget): boolean {
  const recipients = item.toRecipients.map((a) => a.toLowerCase());
  const recipientOk = recipients.length === 1 && recipients[0] === t.recipient.toLowerCase();
  // D2 — one limb, two codomains. The RECORD-FINGERPRINT form wins when supplied; otherwise the plaintext
  // MATCH-KEY form, byte-for-byte as before. Never both, and never a fallback between them: a caller that
  // supplies a match key and gets no hit has NOT corroborated, and must not be rescued by the other rule.
  const subjectOk =
    t.subjectMatchKey !== undefined
      ? recordFingerprint(item.subject) === t.subjectMatchKey
      : fingerprint(item.subject) === t.subjectFingerprint;
  const sentMs = Date.parse(item.sentDateTime);
  const timeOk = Number.isFinite(sentMs) && sentMs >= t.sentAtWindow.fromMs && sentMs <= t.sentAtWindow.toMs;
  // Body is a preview; require the target fingerprint to be a prefix of the previewed body (or vice-versa) when present.
  const bodyFp = fingerprint(item.bodyPreview);
  const bodyOk = t.bodyFingerprint.length === 0 || bodyFp.startsWith(t.bodyFingerprint) || t.bodyFingerprint.startsWith(bodyFp);
  // If the target has an id, it MUST match; if it doesn't, the other three corroborate. Either way, id is never alone.
  const idOk = t.internetMessageId == null || item.internetMessageId === t.internetMessageId;
  return recipientOk && subjectOk && timeOk && bodyOk && idOk;
}

/** A bounce/NDR for this send: from postmaster/mailer-daemon and referencing the recipient. Returns a reason or null. */
export function bounceReason(item: InboxItem, t: VerificationTarget): string | null {
  const from = item.from.toLowerCase();
  const isDaemon = /postmaster|mailer-daemon|microsoftexchange|delivery|mail delivery/i.test(from) ||
    /undeliverable|delivery status notification|delivery has failed|failure notice|returned mail/i.test(item.subject);
  if (!isDaemon) return null;
  const blob = `${item.subject} ${item.bodyPreview}`;
  if (!blob.toLowerCase().includes(t.recipient.toLowerCase())) return null; // must reference OUR recipient
  const code = /(5\.\d\.\d|4\.\d\.\d|55\d\s?\d?|SMTP;?\s?5\d\d)/.exec(blob);
  return code ? `NDR ${code[0]}` : 'NDR (reason code not parsed)';
}

/**
 * Run the oracle. `prior` gives idempotency: a previously-recorded TERMINAL outcome is returned without re-polling
 * (verification must never re-run an effect or flip a terminal truth). A prior HOLD/UNKNOWN is re-attempted (the
 * reason HOLDs exist is to be resolved later). Exhausting the bounded backoff without a match or a bounce →
 * UNKNOWN → HOLD — deliberately NOT VERIFIED_SUCCESS (uncertainty is never success).
 */
export async function verifyEffect(
  target: VerificationTarget,
  deps: VerifyDeps,
  prior?: VerifyResult,
): Promise<VerifyResult> {
  if (prior && (prior.state === 'VERIFIED_SUCCESS' || prior.state === 'VERIFY_FAILED')) {
    return prior; // idempotent — a terminal outcome is never recomputed
  }
  /**
   * D1 — THE WIDTH BOUND, enforced BEFORE any read. A window too wide to identify one message cannot be made
   * safe by reading harder, so this refuses without spending a provider call. UNKNOWN, never VERIFIED.
   * A reversed window (toMs < fromMs) is malformed and refused by the same rule rather than silently matching
   * nothing — the two are indistinguishable in the result otherwise.
   */
  if (target.maxWidthMs !== undefined) {
    const width = target.sentAtWindow.toMs - target.sentAtWindow.fromMs;
    if (!Number.isFinite(width) || width < 0 || width > target.maxWidthMs) {
      return {
        state: 'HOLD',
        matchedMessageId: null,
        bounceReason: null,
        attempts: 0,
        detail: `corroboration window is ${width}ms wide, bound is ${target.maxWidthMs}ms — UNKNOWN, held for reconciliation (a window too wide to identify one message is never VERIFIED)`,
        observedEffectAt: null,
      };
    }
  }
  const schedule = deps.backoffMs ?? DEFAULT_BACKOFF;
  for (let i = 0; i < schedule.length; i += 1) {
    if (schedule[i] > 0) await deps.sleep(schedule[i]);
    // A bounce is a definitive negative — check it first.
    const inbox = await deps.readInbox();
    for (const msg of inbox) {
      const reason = bounceReason(msg, target);
      if (reason) {
        return { state: 'VERIFY_FAILED', matchedMessageId: null, bounceReason: reason, attempts: i + 1, detail: `bounce/NDR observed: ${reason}`, observedEffectAt: null };
      }
    }
    const sent = await deps.readSentItems();
    /**
     * AMBIGUITY IS NOT CORROBORATION. `find` returns the FIRST match and asks no question about the second.
     * That is safe for a tuple carrying a unique id or a raw subject, and unsafe for the store-driven tuple
     * (recipient + subject-hash + interval), where two sends with identical parameters are indistinguishable
     * BY CONSTRUCTION — they hash to the same `idem`, hence the same transitionId and the same record.
     * When the caller asks for it, two matches mean we cannot say WHICH message corroborates, and the honest
     * answer is UNKNOWN. ABSENT ⇒ first-match, exactly as before.
     */
    if (target.requireUniqueMatch === true) {
      const hits = sent.filter((m) => matchesTuple(m, target));
      if (hits.length > 1) {
        return {
          state: 'HOLD',
          matchedMessageId: null,
          bounceReason: null,
          attempts: i + 1,
          detail: `${hits.length} Sent Items rows match the same tuple — AMBIGUOUS, held for reconciliation (ambiguity is never corroboration)`,
          observedEffectAt: null,
        };
      }
    }
    const hit = sent.find((m) => matchesTuple(m, target));
    if (hit) {
      return { state: 'VERIFIED_SUCCESS', matchedMessageId: hit.internetMessageId, bounceReason: null, attempts: i + 1, detail: 'corroborated match in Sent Items (recipient + subject + timestamp' + (target.internetMessageId ? ' + id)' : ')'), observedEffectAt: hit.sentDateTime ?? null };
    }
  }
  // UNKNOWN → HOLD. UNRESOLVED never auto-promotes.
  return { state: 'HOLD', matchedMessageId: null, bounceReason: null, attempts: schedule.length, detail: 'not observed after bounded backoff — UNKNOWN, held for reconciliation (never auto-promoted to SUCCESS)', observedEffectAt: null };
}
