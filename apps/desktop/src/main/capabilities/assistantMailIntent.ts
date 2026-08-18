/**
 * NeuroPause OS — Wave 2 / Slice 13. The AI structured intent generator for `mail.send`.
 *
 * It turns a user's EXPLICIT live turn into a schema-constrained CANDIDATE intent for the `capability:m365.propose`
 * path. The generator has ZERO authority: everything it emits is untrusted data, re-validated downstream (the propose
 * path re-resolves the capability and re-validates every param; the producer applies comma hardening, etc.).
 *
 * The constitutional point of this module is the DETERMINISTIC SAFETY BOUNDARY it wraps around the (untrusted)
 * drafting model, so the safety properties hold for ANY model output — including a hostile or compromised one:
 *
 *   1. RECIPIENT LITERALISM — recipients are extracted LITERALLY from the user's live turn. The model's proposed
 *      addresses are NEVER a source, and names/aliases ("finance", "my accountant") are NEVER resolved from synced
 *      contacts or directory data (a poisoned contact is an injection vector). A send with no literal address →
 *      NEEDS_CLARIFICATION, always.
 *   2. CONTEXT IS INERT — `context` (synced material the user may point at, e.g. the email being replied to)
 *      authorizes understanding of INTENT only; it never sources recipients or the action. Instructions embedded in
 *      synced content cannot create an action, add a recipient, or change the capability.
 *   3. TRIGGER DISCIPLINE — an intent is emitted ONLY when the USER TURN itself deterministically reads as an
 *      in-scope send request. A hostile synced body with no user action yields zero intents.
 *   4. DENY-BY-DEFAULT SCOPE — only `mail.send`. A clear out-of-scope action verb in the turn → UNSUPPORTED,
 *      fail-closed, BEFORE the model is ever consulted.
 *
 * The model's ONLY job is to DRAFT the subject/body of an intent whose action and recipients are already decided by
 * the deterministic guards. That is the constitutional separation: AI proposes (drafts) — validation/authority decide.
 */
import { z } from 'zod';

/** Synced reference material the user may point at. INERT: it never sources recipients or the action decision. */
export interface AssistantMailContext {
  /** e.g. the body of the email being replied to. Reference only — deliberately NOT a source of params. */
  readonly referenceText?: string;
  // NOTE: there is intentionally NO contacts/directory field here. Resolving a recipient from synced data is
  // forbidden (rule 1) — a poisoned contact entry would become an injection vector.
}

/** The UNTRUSTED candidate a drafting model proposes. Every field is data; the guards decide what survives. */
export interface RawMailDraft {
  readonly subject: string;
  readonly body: string;
  readonly purpose?: string;
}

/** The drafting model seam. Given the turn + inert context, it returns a subject/body draft (UNTRUSTED). */
export type MailDrafter = (userTurn: string, context: AssistantMailContext) => RawMailDraft;

/** The generator's result. Only INTENT carries an actionable candidate; the rest are safe non-emissions. */
export type AssistantMailIntentResult =
  | {
      readonly kind: 'INTENT';
      readonly capabilityId: 'mail.send';
      readonly params: { readonly to: readonly string[]; readonly subject: string; readonly body: string };
      readonly purpose: string;
    }
  | { readonly kind: 'NEEDS_CLARIFICATION'; readonly question: string }
  | { readonly kind: 'UNSUPPORTED'; readonly detail: string }
  | { readonly kind: 'NO_ACTION'; readonly detail: string };

/** Zod schema for the emitted intent — an additional guard before the candidate reaches the propose path. */
export const MailSendIntentSchema = z.object({
  capabilityId: z.literal('mail.send'),
  params: z.object({
    to: z.array(z.string().min(1)).min(1),
    subject: z.string().max(255),
    body: z.string().max(100_000),
  }),
  purpose: z.string().max(2000),
});
export type MailSendIntent = z.infer<typeof MailSendIntentSchema>;

// ── deterministic classifiers (the safety boundary — model-independent) ──────────────────────────────────

const MAX_SUBJECT = 255;
const MAX_BODY = 100_000;
const MAX_PURPOSE = 2000;
const STRICT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Loose scan for address-shaped tokens in free text; trimmed + re-validated against STRICT_EMAIL_RE below.
const ADDR_SCAN_RE = /[^\s,<>()"']+@[^\s,<>()"']+\.[^\s,<>()"']+/g;

/** Pull the addresses the user LITERALLY typed in this turn. This is the ONLY source of recipients. */
export function extractLiteralAddresses(text: string): string[] {
  const found = text.match(ADDR_SCAN_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    // The scan already excludes commas from a token, so a comma in the turn acts as a separator between addresses
    // (consistent with the producer's string path) — no single extracted address can contain one.
    const addr = raw.replace(/[.,;:!?]+$/, '').trim().toLowerCase();
    if (!STRICT_EMAIL_RE.test(addr)) continue;
    if (!seen.has(addr)) {
      seen.add(addr);
      out.push(addr);
    }
  }
  return out;
}

/**
 * A DISPATCH verb commits to SENDING: send/reply/respond/forward, or email/message aimed at a recipient. `t` is
 * lower-cased; capitalized recipient NAMES ("email Bob") are matched separately by hasNamedRecipientDispatch. A
 * compose verb (draft/compose/write) is deliberately NOT here — see hasComposeVerb.
 */
function hasDispatchVerb(t: string): boolean {
  return (
    /\bsend\b[\s\S]{0,40}\b(e-?mails?|messages?|notes?)\b/.test(t) ||
    /\b(reply|respond)\b/.test(t) ||
    /\bforward\b[\s\S]{0,40}\b(e-?mails?|messages?)\b/.test(t) ||
    /\bemail\b\s+(to\s+)?([a-z0-9._%+-]+@|him\b|her\b|them\b|us\b|me\b|everyone\b|finance\b|marketing\b|sales\b|support\b|legal\b|hr\b|the\s+team\b|the\s+group\b|my\s+[a-z]+\b)/.test(t) ||
    /\bmessage\b\s+(to\s+)?([a-z0-9._%+-]+@|him\b|her\b|them\b|us\b|me\b|my\s+[a-z]+\b)/.test(t)
  );
}

/** "email Bob" / "message Dana" — a capitalized recipient name. Checked on the ORIGINAL-case turn. */
function hasNamedRecipientDispatch(originalTurn: string): boolean {
  return /\b(email|message)\s+(to\s+)?[A-Z][a-z]+/.test(originalTurn);
}

/**
 * A COMPOSE verb (draft/compose/write an email) PREPARES content — the assistant's existing draft feature. It is a
 * mail.send ONLY when a literal recipient address is present; without one it is NOT a send and must fall through.
 */
function hasComposeVerb(t: string): boolean {
  return /\b(draft|compose|write)\b[\s\S]{0,40}\b(e-?mails?|messages?|notes?)\b/.test(t);
}

/** Clear out-of-scope ACTION verbs. Deny-by-default: matched (and not a mail dispatch) → UNSUPPORTED, fail-closed. */
function hasOutOfScopeAction(t: string): boolean {
  const outOfScope =
    /\b(delete|erase|remove|archive|trash|unsubscribe|mark|flag|move|label)\b/.test(t) ||
    /\b(schedule|book|reschedule|cancel|rsvp|accept|decline|invite)\b[\s\S]{0,40}\b(meeting|event|invite|call|appointment|flight|room)\b/.test(t) ||
    /\b(pay|transfer|wire|refund|buy|purchase|order|invoice|checkout)\b/.test(t) ||
    /\b(deploy|install|execute|run)\b[\s\S]{0,40}\b(update|build|script|command|job)\b/.test(t) ||
    /\b(call|ring|dial|text|sms)\b/.test(t) ||
    /\bcreate\b[\s\S]{0,40}\b(event|meeting|task|file|folder|document|calendar)\b/.test(t) ||
    /\b(book|schedule)\b\s+(a|an|the)\b/.test(t);
  // A clear email DISPATCH beats an out-of-scope verb (the send may merely be ABOUT the other thing; its unsupported
  // part is simply never performed). We never route AROUND validation — we perform only the send.
  return outOfScope && !hasDispatchVerb(t);
}

function clampText(s: string, max: number): string {
  const v = typeof s === 'string' ? s : '';
  return v.length > max ? v.slice(0, max) : v;
}

/**
 * The generator. Deterministic guards decide the action + recipients; the injected `drafter` (the untrusted model)
 * only supplies subject/body. The result is a CANDIDATE — the propose path re-validates everything.
 */
export function assistantMailSendIntent(
  userTurn: string,
  context: AssistantMailContext,
  drafter: MailDrafter,
): AssistantMailIntentResult {
  const turn = (typeof userTurn === 'string' ? userTurn : '').trim();
  if (turn.length === 0) return { kind: 'NO_ACTION', detail: 'empty turn' };

  const lower = turn.toLowerCase();

  // 4 · DENY-BY-DEFAULT SCOPE — runs BEFORE the model is consulted. Only mail.send is supported.
  if (hasOutOfScopeAction(lower)) {
    return { kind: 'UNSUPPORTED', detail: 'Only sending an email (mail.send) is supported right now.' };
  }

  // 3 · TRIGGER DISCIPLINE — a mail.send needs an explicit DISPATCH in the USER TURN (send/reply/forward, or
  // email/message aimed at a recipient). A COMPOSE-only turn ("draft an email …") is the draft feature's job unless
  // it names a literal recipient. Context can never trigger.
  const dispatch = hasDispatchVerb(lower) || hasNamedRecipientDispatch(turn);
  const compose = hasComposeVerb(lower);
  if (!dispatch && !compose) {
    return { kind: 'NO_ACTION', detail: 'No explicit mail-send request in the user turn.' };
  }

  // 1 · RECIPIENT LITERALISM — recipients come only from addresses literally typed in the turn. Never the model,
  // never `context`, never resolved from a name/alias/contact.
  const to = extractLiteralAddresses(turn);
  if (to.length === 0) {
    // A DISPATCH attempt with no recipient must ASK (never guess an address). A COMPOSE-only turn with no recipient
    // is not a send at all — it falls through to the draft feature.
    if (dispatch) {
      return {
        kind: 'NEEDS_CLARIFICATION',
        question: 'Which email address should I send to? Please type the full address — I can’t look it up from a name.',
      };
    }
    return { kind: 'NO_ACTION', detail: 'A compose request with no recipient is handled as a draft, not a send.' };
  }

  // The model DRAFTS subject/body (UNTRUSTED). Its output can never change `to` (already fixed above) or the action.
  const draft = drafter(turn, context);
  const subject = clampText(draft.subject, MAX_SUBJECT);
  const body = clampText(draft.body, MAX_BODY);
  const purpose = clampText(draft.purpose && draft.purpose.trim().length > 0 ? draft.purpose : 'User-initiated mail.send.', MAX_PURPOSE);

  return { kind: 'INTENT', capabilityId: 'mail.send', params: { to, subject, body }, purpose };
}

/**
 * The shipped DEFAULT drafter — a deterministic, offline reference that derives a plausible subject/body from the
 * turn itself. It reads NOTHING from `context` (rule 2: context is inert). A live model can be substituted behind the
 * identical guards without changing any safety property; see the Slice-13 evidence for the model-seam decision.
 */
export const referenceDrafter: MailDrafter = (userTurn) => {
  const turn = userTurn.trim();
  // Prefer an explicit "saying/that/about <X>" clause as the body; else fall back to the whole turn.
  const said = /\b(saying|that says|to say|which says|:)\s+([\s\S]+)$/i.exec(turn);
  const about = /\babout\s+([\s\S]+)$/i.exec(turn);
  const body = (said?.[2] ?? about?.[1] ?? turn).trim();
  const subject = about?.[1]?.trim().slice(0, 60) ?? (body.split(/[.!?\n]/)[0] ?? '').trim().slice(0, 60);
  return { subject, body, purpose: 'User-initiated mail.send.' };
};
