/**
 * A PROOF THAT A PLATFORM OPERATOR AUTHORIZED THIS CALL.
 *
 * WHY A TOKEN AND NOT JUST AN IPC GATE
 *
 * The IPC gate is real and it is where the decision is made. It is also only one
 * door. `apiPlatformStore.setPolicyEnabled` is an ordinary method on a module
 * singleton, and this codebase runs background work through `forEachTenant` that
 * calls stores DIRECTLY, never through the bridge. A gate on the handler leaves
 * the method itself reachable by any future scheduled job, assistant action or
 * automation step — none of which have a session, none of which pass through the
 * authorizer, and all of which would be granted whatever the store hands out.
 *
 * `BackgroundPrincipal` carries a `permissions` array, and it is worth being
 * precise about what that is: it is read by NO authorization code anywhere in this
 * repo. It is a TENANCY mechanism that tells stores whose data to touch. So a
 * background job "holding" `cloud:operate` would mean nothing at all.
 *
 * So the authority is a VALUE the operation requires and cannot be conjured. The
 * constructor is private to this module and the branding symbol is not exported,
 * so `{} as PlatformAuthority` does not typecheck and no runtime shape matches it.
 * The only way to obtain one is `mintPlatformAuthority`, which demands the
 * operator check has already returned true.
 *
 * This is defence in depth, not a replacement: the gate refuses the request, and
 * the token means that if the gate is ever bypassed, moved, or forgotten on a new
 * channel, the operation still cannot run.
 */

/** Not exported. Nothing outside this file can produce a value of this type. */
declare const PLATFORM_AUTHORITY: unique symbol;

/**
 * Evidence of an install-level authorization decision.
 *
 * Carries WHO and WHEN so the audit line is written from the authority itself
 * rather than from whatever the call site happened to have in scope — the two
 * drifting apart is how an audit trail comes to record the wrong actor.
 */
export interface PlatformAuthority {
  readonly [PLATFORM_AUTHORITY]: true;
  /** The operator identity that satisfied the check. */
  readonly operator: string;
  /** The permission that was demanded. */
  readonly permission: 'cloud:operate';
  /** When the decision was made, ISO-8601. */
  readonly at: string;
}

/**
 * Mint an authority. CALL ONLY AFTER the operator check has passed.
 *
 * Deliberately takes the ALREADY-DECIDED result rather than doing the check
 * itself: this module must not import the registry, or it becomes a second place
 * that answers "who is an operator", and two places that answer the same question
 * eventually disagree. `createPlatformAuthorizer` below is the one binding.
 */
function mint(operator: string): PlatformAuthority {
  return {
    operator,
    permission: 'cloud:operate',
    at: new Date().toISOString(),
  } as PlatformAuthority;
}

export interface PlatformAuthorizerDeps {
  /** The signed-in account, or null. */
  sessionEmail: () => string | null;
  /** Install-level operator check. See `platformOperatorRegistry.ts`. */
  isOperator: (email: string) => boolean;
}

/**
 * The single place a `PlatformAuthority` comes into existence.
 *
 * Returns null rather than throwing, so a caller can distinguish "refused" from
 * "failed" and the IPC layer keeps ownership of the error message. The refusal
 * message must not reveal whether any operator is configured, because that is
 * information about the machine's administration that a tenant administrator has
 * no claim to.
 */
export function createPlatformAuthorizer(
  deps: PlatformAuthorizerDeps,
): () => PlatformAuthority | null {
  return () => {
    const email = deps.sessionEmail();
    if (email === null || email.trim() === '') return null;
    if (!deps.isOperator(email)) return null;
    return mint(email);
  };
}
