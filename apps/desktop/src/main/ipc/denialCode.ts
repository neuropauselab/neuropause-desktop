/**
 * D-6 — THE AUTHORIZATION ERROR CONTRACT (main side).
 *
 * THE DEFECT this closes, in the certification's own words: *"authorization
 * outcomes are distinguishable only by matching English prose. Rewording a
 * message silently changes renderer behaviour."*
 *
 * THE ROOT CAUSE IS NOT "UNMODELLED". The main process already models
 * authorization denials properly — `enterprise/authz.ts` throws a typed
 * `AuthorizationError` carrying the exact `permission` that was missing. The
 * structure is destroyed exactly one frame before it would be useful:
 * `secureBridge.ts`'s handler catch reduces every rejection to
 * `new IpcError(err.message)`, and Electron's IPC serializes only `message`.
 * So the renderer receives a sentence and nothing else, and seven renderer
 * sites each invented their own regex over that sentence.
 *
 * THE ONLY THING THAT CROSSES IS THE MESSAGE, so the discriminant travels in
 * the message — as a machine-readable prefix the renderer strips before
 * anything is displayed. That is deliberately the least invasive transport
 * available: it needs no change to the response envelope, no new channel, and
 * no touch of `packages/shared`, which is a FROZEN surface.
 *
 * WHY THIS VOCABULARY IS DUPLICATED IN THE RENDERER, and must not be "fixed"
 * by merging: main resolves `@neuropause/shared` and renderer resolves
 * `@renderer/*` — there is NO non-frozen module both sides can import, and
 * `packages/shared/` is frozen (certification/frozen-surfaces.json). The two
 * copies are held identical by `denialCodeContract.test.ts`, which reads both
 * files and fails if they drift. A checked duplicate is honest; a frozen-surface
 * edit to avoid it would need an FG gate this fix does not have.
 */

/**
 * The closed set of authorization outcomes a renderer may branch on.
 *
 * Deliberately small and about AUTHORITY only. This is not a general error
 * taxonomy: a channel that is merely broken, timed out, or unimplemented has
 * no code here, because the renderer's question is "was I refused, or is it
 * broken?" and inventing codes for the second half would blur exactly the line
 * this contract exists to draw.
 */
export const DENIAL_CODE = {
  /** No authenticated or device-local principal. The user must sign in. */
  NOT_AUTHENTICATED: 'not-authenticated',
  /** A principal exists and lacks the required permission (RBAC). */
  MISSING_PERMISSION: 'missing-permission',
  /** A principal exists but is bound to no organization member. */
  NOT_A_MEMBER: 'not-a-member',
  /** The authorization dependency itself is absent — fail closed, not "denied". */
  AUTHZ_UNAVAILABLE: 'authz-unavailable',
  /** The calling frame is not a trusted sender. */
  UNTRUSTED_SENDER: 'untrusted-sender',
} as const;

export type DenialCode = (typeof DENIAL_CODE)[keyof typeof DENIAL_CODE];

/** Every code, for exhaustiveness checks and the cross-side parity pin. */
export const DENIAL_CODES: readonly DenialCode[] = Object.values(DENIAL_CODE);

/**
 * The wire prefix. Chosen to be unmistakable and never plausible user copy, so
 * an unstamped message can never be mistaken for a stamped one, and a stamp
 * that reaches a screen is obviously a bug rather than a plausible sentence.
 */
export const DENIAL_STAMP_OPEN = 'NPDENY:';
export const DENIAL_STAMP_CLOSE = '|';

/**
 * Prefix `message` with `code` for transport.
 *
 * The message is otherwise untouched: the renderer strips the stamp and the
 * ~80 sites that render `err.message` see exactly the text they see today.
 * Already-stamped messages are returned unchanged so a rethrow cannot nest
 * stamps.
 */
export function stampDenial(code: DenialCode, message: string): string {
  if (message.startsWith(DENIAL_STAMP_OPEN)) return message;
  return `${DENIAL_STAMP_OPEN}${code}${DENIAL_STAMP_CLOSE}${message}`;
}

/** True when `message` already carries a stamp. */
export function isStamped(message: string): boolean {
  return message.startsWith(DENIAL_STAMP_OPEN);
}

/**
 * Classify a caught error into a denial code, or `null` when it is not an
 * authorization outcome.
 *
 * ORDER MATTERS AND IS THE POINT: the typed check comes first, so an
 * `AuthorizationError` is recognised by its CONSTRUCTOR, never by its wording.
 * The literal-message checks that follow exist only for the handful of denial
 * sites that still throw a bare `Error`; each is anchored to a message this
 * repository owns, and every one of them is a candidate for conversion to a
 * typed error later. They are a migration aid, not the contract.
 *
 * Anything unrecognised returns `null` — an unknown failure must never be
 * dressed up as a refusal, because "you may not" and "it is broken" are
 * different answers and the renderer renders them differently.
 */
export function classifyDenial(err: unknown): DenialCode | null {
  if (!(err instanceof Error)) return null;

  // TYPED — the authoritative path.
  if (err.name === 'AuthorizationError') return DENIAL_CODE.MISSING_PERMISSION;

  /**
   * TENANCY — reuse the vocabulary that already exists rather than inventing a
   * parallel one. `TenantContextError` (enterprise/authzGate.ts) carries the
   * eight-valued `TenantRefusalReason` from `packages/shared`, which predates
   * this contract and is the canonical tenancy answer. Reading it here means a
   * membership refusal is classified from its TYPED reason, never its sentence.
   *
   * ONLY SOME OF THE EIGHT ARE DENIALS, and the split is the careful part:
   *   not_signed_in                                   → an authority answer
   *   not_a_member / not_in_workspace / member_inactive → authority answers
   *   tenant_not_operable                              → authority answer
   *     (suspended or archived tenant: the user may not proceed)
   *   not_loaded / no_workspace / workspace_orphaned   → NOT denials
   *
   * That last line is the one that matters. `not_loaded` is a COLD START and
   * `workspace_orphaned` is a data fault; reporting either as "you do not have
   * access" would be a confident false claim about the user's account — the
   * exact failure this codebase refuses everywhere else. They return `null` and
   * surface as the faults they are.
   */
  if (err.name === 'TenantContextError') {
    const reason = (err as Error & { reason?: unknown }).reason;
    switch (reason) {
      case 'not_signed_in':
        return DENIAL_CODE.NOT_AUTHENTICATED;
      case 'not_a_member':
      case 'not_in_workspace':
      case 'member_inactive':
      case 'tenant_not_operable':
        return DENIAL_CODE.NOT_A_MEMBER;
      default:
        // not_loaded · no_workspace · workspace_orphaned — and anything added
        // later, which must be classified deliberately rather than by default.
        return null;
    }
  }

  // LITERAL — bounded migration aid for the untyped denial throws that remain.
  const m = err.message;
  if (m.startsWith('Sign in to continue')) return DENIAL_CODE.NOT_AUTHENTICATED;
  if (m.startsWith('Authorization is not available')) return DENIAL_CODE.AUTHZ_UNAVAILABLE;
  if (m.startsWith('No organization member is bound')) return DENIAL_CODE.NOT_A_MEMBER;
  if (m.startsWith('Untrusted sender')) return DENIAL_CODE.UNTRUSTED_SENDER;

  return null;
}
