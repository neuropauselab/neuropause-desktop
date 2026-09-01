/**
 * NeuroPause Platform — deterministic application error contract (ERP Session 19).
 *
 * The CLOSED set of errors an adapter may see. Raw internal exceptions, command
 * codes, database paths, secrets, stack traces and tenant data NEVER cross this
 * boundary — every failure maps to one of these codes and a fixed, safe message.
 */
export type ApplicationErrorCode =
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'TENANT_SCOPE_VIOLATION'
  | 'VALIDATION_ERROR'
  | 'POLICY_DENIED'
  | 'CONFLICT'
  | 'IDEMPOTENCY_REPLAY'
  | 'NOT_FOUND'
  | 'TRANSIENT_FAILURE';

/** Fixed, client-safe messages — no internal detail, ever. */
const SAFE_MESSAGE: Record<ApplicationErrorCode, string> = {
  UNAUTHENTICATED: 'Authentication is required.',
  UNAUTHORIZED: 'You are not authorized to perform this operation.',
  TENANT_SCOPE_VIOLATION: 'The request is outside your tenant scope.',
  VALIDATION_ERROR: 'The request was not valid.',
  POLICY_DENIED: 'The operation was denied by policy.',
  CONFLICT: 'The operation conflicts with the current state of the resource.',
  IDEMPOTENCY_REPLAY: 'This request was already processed; the original result is returned.',
  NOT_FOUND: 'The requested resource was not found.',
  TRANSIENT_FAILURE: 'A temporary failure occurred. Please retry.',
};

export function safeMessage(code: ApplicationErrorCode): string {
  return SAFE_MESSAGE[code];
}

/**
 * Map an internal command-result error (a code OR a module message) to the
 * closed application error set. Deny-by-default: an unrecognised error becomes a
 * CONFLICT (a state precondition failed), never a leaked raw string.
 */
export function mapCommandError(error: string | undefined): ApplicationErrorCode {
  switch (error) {
    case 'UNRESOLVED_TENANT':
      return 'UNAUTHENTICATED';
    case 'CROSS_TENANT_CLAIM':
    case 'CROSS_WORKSPACE_CLAIM':
      return 'TENANT_SCOPE_VIOLATION';
    case 'UNAUTHORIZED':
      return 'UNAUTHORIZED';
    case 'VALIDATION_FAILED':
    case 'MISSING_COMMAND_ID':
    case 'MISSING_ACTOR':
    case 'MISSING_CORRELATION_ID':
    case 'MISSING_IDEMPOTENCY_KEY':
    case 'MISSING_TARGET':
    case 'UNKNOWN_COMMAND':
      return 'VALIDATION_ERROR';
    case 'COMMIT_FAILED':
    case 'COMMAND_FAILED':
    case 'NO_IDEMPOTENCY_BACKEND':
      return 'TRANSIENT_FAILURE';
    default:
      if (error && /not found/i.test(error)) return 'NOT_FOUND';
      return 'CONFLICT'; // action refusals (…_REFUSED, precondition messages) → state conflict
  }
}
