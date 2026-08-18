/**
 * BRAIN-1 — the mail-draft lane of the brain gateway.
 *
 * ONE place the draft lane produces a subject/body. It fronts an UNTRUSTED model
 * adapter with: schema-constrained prompt → parse → zod validation → ONE repair
 * retry → honest deterministic fallback (`referenceDrafter`, the permanent
 * zero-model default). The model NEVER sees or sets `to`/action — those are
 * owned by the deterministic guards in `assistantMailSendIntent`, AROUND this
 * seam (proven model-independent by the hostile-adapter CI gate). This gateway
 * only fills subject/body, and even that is zod-clamped before it can be used.
 *
 * Lanes: `draft` (here), `reason` (existing `aiEngine.run`), `embed` (reserved).
 * Per the BRAIN-1 decision, the LIVE draft lane serves `referenceDrafter` until
 * the ④ eval report clears the bar and the operator flips it — see
 * `servingDraftMailer()` and DECISIONS D-13.
 */
import { z } from 'zod';
import {
  referenceDrafter,
  type AssistantMailContext,
  type MailDrafter,
  type RawMailDraft,
} from '../../capabilities/assistantMailIntent';

/** The drafter output contract — subject/body within the same limits the
 *  generator clamps to. Enforced (not merely declared) here. */
export const RawMailDraftSchema = z.object({
  subject: z.string().min(1).max(255),
  body: z.string().min(1).max(100_000),
  purpose: z.string().max(2000).optional(),
});

/**
 * A draft-lane model adapter: given the turn + INERT context (never authority),
 * return raw model text — expected to be JSON `{subject, body[, purpose]}`. The
 * optional `repairHint` is passed on the single repair retry. UNTRUSTED output.
 */
export type DraftAdapter = (
  userTurn: string,
  context: AssistantMailContext,
  repairHint?: string,
) => Promise<string>;

/** How a draft was ultimately produced — for provenance + the eval report. */
export type DraftServedBy = 'model' | 'model-repaired' | 'fallback';

export interface DraftOutcome {
  readonly draft: RawMailDraft;
  readonly servedBy: DraftServedBy;
  /** 0 = valid first try; 1 = valid after the single repair retry. */
  readonly repairs: number;
  /** Why the fallback served (schema-invalid after repair, or adapter error). */
  readonly fallbackReason?: string;
}

const REPAIR_HINT =
  'Your previous reply was not valid. Respond with ONLY a JSON object ' +
  '{"subject": string, "body": string} — subject ≤255 chars, body ≤100000 chars, no other text.';

/** Fence-tolerant JSON-object extraction, then zod. Returns null on any failure. */
export function parseDraft(raw: string): RawMailDraft | null {
  const stripped = raw.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let json: unknown;
  try {
    json = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = RawMailDraftSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * Produce a mail draft through the gateway: model → zod → ONE repair retry →
 * honest `referenceDrafter` fallback. Never throws (adapter errors fall back).
 * This is the ASYNC path a real model uses; the live serving lane currently
 * routes to the sync `referenceDrafter` (see `servingDraftMailer`).
 */
export async function draftMailViaGateway(
  adapter: DraftAdapter,
  userTurn: string,
  context: AssistantMailContext,
): Promise<DraftOutcome> {
  // Attempt 0 = initial; attempt 1 = the single repair retry.
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    let raw: string;
    try {
      raw = await adapter(userTurn, context, attempt === 0 ? undefined : REPAIR_HINT);
    } catch (err) {
      return {
        draft: referenceDrafter(userTurn, context),
        servedBy: 'fallback',
        repairs: attempt,
        fallbackReason: `adapter error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const draft = parseDraft(raw);
    if (draft) {
      return { draft, servedBy: attempt === 0 ? 'model' : 'model-repaired', repairs: attempt };
    }
  }
  return {
    draft: referenceDrafter(userTurn, context),
    servedBy: 'fallback',
    repairs: 1,
    fallbackReason: 'schema-invalid after one repair retry',
  };
}

/**
 * The MailDrafter the LIVE draft lane serves. Per the BRAIN-1 decision + bar
 * (DECISIONS D-13), this is the deterministic `referenceDrafter` until the eval
 * report clears the bar AND the operator flips the lane to a specific model.
 * A model that misses the bar stays off the lane — the bar never moves to fit it.
 *
 * NOTE: flipping to a real (async) model requires the two-pass wiring (async
 * gateway pre-compute → sync `() => draft` into `assistantMailSendIntent`), so
 * the deterministic guards still own `to`/action. That is a deliberate,
 * eval-gated future change, not done here.
 */
export function servingDraftMailer(): MailDrafter {
  return referenceDrafter;
}
