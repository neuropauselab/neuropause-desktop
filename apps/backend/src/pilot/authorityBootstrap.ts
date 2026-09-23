import type { AuthorityDecisionArtifact, PilotRole, RoleBinding } from './authorityEvaluator';
import { ROLE_ACTIONS } from './authorityEvaluator';

/*
 * The role vocabulary is DERIVED from the role/action matrix rather than kept as a parallel
 * list. H14 measured what a hand-maintained mirror costs: it drifts silently. A role added to
 * ROLE_ACTIONS is bindable here automatically; a role that exists only here cannot be invented.
 */
const KNOWN_ROLES: readonly string[] = Object.keys(ROLE_ACTIONS);

/* ==========================================================================================
 * ENG-11 — THE GOVERNED WRITE PATH INTO pilot_role_bindings.
 *
 * THE BOOTSTRAP PARADOX, AND WHY OPTION B DISSOLVES IT.
 * `explainAuthority` step 3 requires the actor to hold a role binding. So binding the FIRST
 * role could never be authorized by a role binding — NP-010 recorded this as a paradox and no
 * write path was ever built. Option B is what resolves it: authority originates OUTSIDE the
 * system, in an instrument signed by the designated issuer (H1) and admitted only through the
 * H13 out-of-band-anchored trust root. **The signed instrument authorizes the binding. A
 * pre-existing binding is not required and is deliberately not consulted.**
 *
 * HOW THE SUBJECT IS BOUND CRYPTOGRAPHICALLY WITHOUT A NEW COLUMN.
 * `pilot_authority_decisions` has no subject column, and adding one is H4 — an open governance
 * question about what an instrument must contain, which engineering may not decide. But
 * `instrument` IS already inside SIGNED_FIELDS. So the subject and role are encoded INTO the
 * instrument name:
 *
 *     NP-PILOT-BIND:<subjectId>:<role>
 *
 * The issuer signs that exact string, so who is bound and to what are covered by the same
 * Ed25519 signature as everything else. No schema change, no governance decision, and no
 * unsigned field carries authority meaning.
 * ========================================================================================== */

export const BINDING_INSTRUMENT_PREFIX = 'NP-PILOT-BIND';

export type BootstrapRefusal =
  | 'INSTRUMENT_MALFORMED'
  | 'INSTRUMENT_SUBJECT_MISMATCH'
  | 'INSTRUMENT_ROLE_MISMATCH'
  | 'INSTRUMENT_NOT_ADMITTED'
  | 'INSTRUMENT_NOT_AUTHENTICATED'
  | 'INSTRUMENT_NOT_IN_FORCE'
  | 'INSTRUMENT_OUT_OF_SCOPE'
  | 'SELF_ASSIGNMENT_DENIED'
  | 'UNKNOWN_ROLE'
  | 'SUBJECT_MALFORMED'
  | 'DUPLICATE_BINDING'
  | 'CONFLICTING_BINDING';

export type BootstrapOutcome = { ok: true } | { ok: false; reason: BootstrapRefusal };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Splits on the FIRST two colons only, so a role containing no colon round-trips exactly. */
export function parseBindingInstrument(
  instrument: string,
): { subjectId: string; role: string } | null {
  const parts = instrument.split(':');
  if (parts.length !== 3) return null;
  const [prefix, subjectId, role] = parts;
  if (prefix !== BINDING_INSTRUMENT_PREFIX) return null;
  if (!subjectId || !role) return null;
  return { subjectId, role };
}

export interface BootstrapRequest {
  /** Who is performing the write — the administrator (H2). */
  readonly actorId: string;
  readonly subjectId: string;
  readonly role: string;
  /** The signed instrument naming this exact binding. */
  readonly instrument: string;
}

/**
 * The whole decision, as a pure function of admitted instruments and existing bindings.
 *
 * `admitted` must be the output of `loadAuthorityDecisions`, i.e. rows that have ALREADY passed
 * Ed25519 verification against the H13-anchored trust root. Nothing here re-checks signatures:
 * an unverified row never becomes an `AuthorityDecisionArtifact` in the first place.
 */
export function evaluateBootstrap(
  req: BootstrapRequest,
  admitted: readonly AuthorityDecisionArtifact[],
  existing: readonly RoleBinding[],
  now: Date,
): BootstrapOutcome {
  const deny = (reason: BootstrapRefusal): BootstrapOutcome => ({ ok: false, reason });

  if (!UUID.test(req.subjectId)) return deny('SUBJECT_MALFORMED');
  if (!KNOWN_ROLES.includes(req.role)) return deny('UNKNOWN_ROLE');

  /*
   * SELF-ASSIGNMENT IS REFUSED BEFORE THE INSTRUMENT IS EVEN LOOKED UP.
   * H13 requirement 9 and the C1 resolution both turn on this. Checking it first means a
   * self-assignment attempt cannot be used to probe which instruments exist.
   */
  if (req.actorId === req.subjectId) return deny('SELF_ASSIGNMENT_DENIED');

  const parsed = parseBindingInstrument(req.instrument);
  if (!parsed) return deny('INSTRUMENT_MALFORMED');
  // The instrument is signed; the request is not. Where they disagree, the SIGNATURE wins.
  if (parsed.subjectId.toLowerCase() !== req.subjectId.toLowerCase())
    return deny('INSTRUMENT_SUBJECT_MISMATCH');
  if (parsed.role !== req.role) return deny('INSTRUMENT_ROLE_MISMATCH');

  const artifact = admitted.find((a) => a.instrument === req.instrument);
  if (!artifact) return deny('INSTRUMENT_NOT_ADMITTED');
  if (!artifact.authenticated) return deny('INSTRUMENT_NOT_AUTHENTICATED');
  if (artifact.environmentClass !== 'PILOT') return deny('INSTRUMENT_OUT_OF_SCOPE');
  if (artifact.revokedAt !== null && new Date(artifact.revokedAt) <= now)
    return deny('INSTRUMENT_NOT_IN_FORCE');
  if (new Date(artifact.effectiveFrom) > now) return deny('INSTRUMENT_NOT_IN_FORCE');
  if (artifact.expiresAt !== null && new Date(artifact.expiresAt) <= now)
    return deny('INSTRUMENT_NOT_IN_FORCE');

  const liveFor = (b: RoleBinding): boolean =>
    !(b.revokedAt !== null && new Date(b.revokedAt) <= now)
    && (b.expiresAt === null || new Date(b.expiresAt) > now);

  const live = existing.filter(liveFor);
  if (live.some((b) => b.subjectId === req.subjectId && b.role === req.role))
    return deny('DUPLICATE_BINDING');
  /*
   * CONFLICT: one subject, one live role. The pilot's three roles are separations of duty —
   * a subject holding two of them collapses the separation the roles exist to create, and
   * C1's residual-risk acceptance depends on that separation holding.
   */
  if (live.some((b) => b.subjectId === req.subjectId && b.role !== req.role))
    return deny('CONFLICTING_BINDING');

  return { ok: true };
}

export type { PilotRole };
