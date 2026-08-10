/**
 * Identity — who is acting, on whose behalf, and on what evidence.
 *
 * THREE THINGS THIS FILE IS ABOUT, AND WHY EACH EXISTS
 *
 * 1. EXTERNAL IDENTITY. A provider's own account or record, linked to something
 *    in NeuroPause. Program 9 gave a connected ACCOUNT a stable
 *    `providerAccountId`, but nothing joined a provider's contact to a
 *    NeuroPause customer as an identity — the bridge matched records and threw
 *    the reasoning away. An identity link keeps the reasoning.
 *
 * 2. IDENTITY STATE. `KNOWN | PROBABLE | AMBIGUOUS | UNKNOWN | REVOKED`. The
 *    states are the whole point: identity is not string matching, and the
 *    difference between "these are the same" and "these look similar" is the
 *    difference between a correct ledger and a corrupted one. Nothing promotes
 *    AMBIGUOUS to KNOWN without a person's recorded decision.
 *
 * 3. SERVICE IDENTITY. A non-human principal. Before this, a scheduled sync ran
 *    with `actor() === null` and — because permissions resolve from a signed-in
 *    email — zero permissions. So the governed write either did not happen or,
 *    had it borrowed the signed-in administrator, would have run every fifteen
 *    minutes with their full authority. Neither is acceptable. A service
 *    identity is a third answer: its own id, its own explicit scopes, its own
 *    workspace.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No secret, no token, no credential material of any kind. An identity says
 * WHO; the vault holds WHAT THEY PROVE IT WITH, and the two are separate files
 * for the same reason they are separate concepts.
 */
import type { EnterprisePermission } from './enterprise';

/**
 * How sure we are that two identities are one thing.
 *
 * Ordered by strength. `PROBABLE` is deliberately distinct from `KNOWN`: a
 * canonicalised name match is real evidence and is not proof, and collapsing
 * the two is exactly the mistake that merges two companies into one customer.
 */
export type IdentityState =
  /** A declared identifier matched literally. Acted on. */
  | 'known'
  /** Strong but not conclusive evidence. Usable, flagged, never merged. */
  | 'probable'
  /** More than one plausible answer, or one weak one. A person decides. */
  | 'ambiguous'
  /** No candidate. Not a failure — often the correct answer. */
  | 'unknown'
  /** The provider withdrew the credential. Kept, not deleted. */
  | 'revoked';

export const IDENTITY_STATE_LABEL: Record<IdentityState, string> = {
  known: 'Confirmed',
  probable: 'Probably the same',
  ambiguous: 'Needs a decision',
  unknown: 'Not matched',
  revoked: 'Access revoked',
};

/**
 * One reason to believe a link.
 *
 * `kind` is ordered by strength in `EVIDENCE_STRENGTH` below. `value` is
 * present only for evidence whose value is not itself sensitive — a matched
 * provider id is safe to show, an email is shown, and nothing here ever
 * carries a credential.
 */
export interface IdentityEvidence {
  kind:
    /** The provider's own id for the object. The strongest external evidence. */
    | 'provider_id'
    /** A declared business key — a customer code, an invoice number. */
    | 'business_key'
    /** An email address, compared literally. */
    | 'email_exact'
    /** A phone number, compared after stripping formatting. */
    | 'phone_exact'
    /** Names that agree only after canonicalisation. Weak. */
    | 'name_canonical'
    /** An existing relationship already connects these two. */
    | 'existing_relationship'
    /** A person said so. */
    | 'human_decision';
  /** The field the evidence came from, in the source's own words. */
  field: string;
  /** The matched value, when showing it is safe. Null when it is not. */
  value: string | null;
  /** Plain words: what this evidence actually establishes. */
  detail: string;
}

/** Ordered weakest-last, so a set of evidence can be scored deterministically. */
export const EVIDENCE_STRENGTH: Record<IdentityEvidence['kind'], number> = {
  human_decision: 100,
  provider_id: 90,
  business_key: 80,
  email_exact: 70,
  phone_exact: 50,
  existing_relationship: 40,
  name_canonical: 20,
};

/** What a NeuroPause-side identity actually is. */
export type IdentitySubjectKind =
  /** A record in an enterprise module — a customer, a contact, a supplier. */
  | 'record'
  /** A person in the organization, keyed by the email the app authenticates on. */
  | 'org_member';

export interface IdentitySubject {
  kind: IdentitySubjectKind;
  /** `moduleId` for a record; the organization id for a member. */
  scopeId: string;
  /** The record id, or the member's email. */
  id: string;
  /** For display. Never load-bearing. */
  label: string;
}

/**
 * A provider-side identity, and what it is linked to.
 *
 * The provider half is FOUR fields on purpose — provider, connection, entity
 * type, entity id. Any fewer and two different objects can collide: HubSpot
 * contact 847392 and HubSpot company 847392 are different things, and the same
 * contact id in two portals is two different people.
 */
export interface ExternalIdentity {
  id: string;
  workspaceId: string;
  provider: string;
  /** The connected account this came through. */
  connectionId: string;
  providerAccountId: string | null;
  providerEntityType: string;
  providerEntityId: string;
  displayName: string;
  /** Present only when the provider supplied one. */
  email: string | null;
  state: IdentityState;
  /** What it is linked to. Null while `ambiguous`, `unknown` or `revoked`. */
  subject: IdentitySubject | null;
  evidence: IdentityEvidence[];
  /** Who confirmed the link, when it was a person. */
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A candidate answer to "which of these is it?", with why it is offered. */
export interface IdentityCandidate {
  subject: IdentitySubject;
  /** The strongest evidence for this candidate, strongest first. */
  evidence: IdentityEvidence[];
  /** Derived from the evidence, never from a model. 0–1. */
  confidence: number;
  /** How the differences read, so a person can see what would change. */
  differs: { field: string; label: string; existing: string; incoming: string }[];
}

/**
 * A question waiting for a person.
 *
 * Program 9 detected these and discarded them: an ambiguous row was counted in
 * a sync summary and then dropped, so nobody was ever asked and the data never
 * arrived. This is the queue that makes the question answerable.
 */
export interface IdentityMatch {
  id: string;
  workspaceId: string;
  provider: string;
  connectionId: string;
  providerEntityType: string;
  providerEntityId: string;
  /** What the provider calls it. */
  incomingLabel: string;
  /** The incoming values, for the side-by-side. Never sensitive fields. */
  incoming: { field: string; label: string; value: string }[];
  /** Where this would be written if it were resolved. */
  destinationModuleId: string;
  destinationLabel: string;
  candidates: IdentityCandidate[];
  state: Extract<IdentityState, 'ambiguous' | 'unknown'>;
  /** Why the engine would not decide. Shown verbatim. */
  reason: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** How many syncs have re-raised it. A rising number is itself a signal. */
  seenCount: number;
}

export type IdentityMatchDecision =
  /** This is that record. Link, and fill only what is empty. */
  | 'confirm'
  /** None of these. Create a new record from the provider's data. */
  | 'create_new'
  /** Not any of them, and do not create. Leave the provider row unlinked. */
  | 'reject';

/** One entry in an identity's history. Reconstructed from the audit trail. */
export interface IdentityHistoryEntry {
  at: string;
  actor: string;
  action: 'linked' | 'confirmed' | 'rejected' | 'created' | 'unlinked' | 'revoked';
  detail: string;
}

/* ── Service identity ─────────────────────────────────────────────────── */

/**
 * A non-human principal.
 *
 * `permissions` is an explicit list, never inherited. The scheduled connector
 * sync needs to write customers; it has no business reading payroll, and a
 * design where it holds an administrator's scopes because an administrator
 * happened to be signed in is a design where the blast radius of a connector
 * bug is the whole company.
 */
export interface ServiceIdentity {
  id: string;
  /** What it is for, in words. Shown wherever it acts. */
  purpose: string;
  /** The only permissions it holds. Union with nothing. */
  permissions: EnterprisePermission[];
  /** The single workspace it may act in. */
  workspaceId: string;
  status: 'active' | 'disabled';
  createdAt: string;
  lastUsedAt: string | null;
  /** Non-null once it has done something, for the health surface. */
  lastAction: string | null;
}

/** Who did a thing. The three cases are not interchangeable. */
export type ActorKind = 'human' | 'service' | 'system';

export interface ActorRef {
  kind: ActorKind;
  /** An email for a human, a service id for a service, null for the system. */
  id: string | null;
  label: string;
}

/** How an actor is written into an audit line, so the three never blur. */
export function describeActor(actor: ActorRef): string {
  switch (actor.kind) {
    case 'human':
      return actor.label;
    case 'service':
      // Named as a service explicitly. An audit trail where a background job
      // is indistinguishable from a person is an audit trail that cannot
      // answer the only question it exists for.
      return `${actor.label} (service)`;
    default:
      return 'NeuroPause (system)';
  }
}

/** Confidence from evidence. Deterministic, and never from a model. */
export function scoreEvidence(evidence: readonly IdentityEvidence[]): number {
  if (evidence.length === 0) return 0;
  /**
   * An unrecognised kind scores ZERO, not `undefined`.
   *
   * Evidence can arrive from a file written by an older or newer build, and
   * `EVIDENCE_STRENGTH[unknown]` is `undefined` → `Math.max` → `NaN` → a screen
   * that renders "NaN%". Unknown evidence is worth nothing, which is both safe
   * and true.
   */
  const strongest = Math.max(...evidence.map((e) => EVIDENCE_STRENGTH[e.kind] ?? 0));
  /**
   * The STRONGEST piece decides, with a small bonus for corroboration.
   *
   * Summing would let three weak signals outrank one conclusive one — three
   * canonicalised name matches are not an email address, and a scheme that
   * says otherwise will merge companies.
   */
  const corroboration = Math.min(10, (evidence.length - 1) * 4);
  return Math.min(1, (strongest + corroboration) / 100);
}

/** The state a set of evidence supports, on its own. */
export function stateFromEvidence(evidence: readonly IdentityEvidence[], candidateCount: number): IdentityState {
  if (candidateCount === 0) return 'unknown';
  if (candidateCount > 1) return 'ambiguous';
  const strongest = evidence.length === 0 ? 0 : Math.max(...evidence.map((e) => EVIDENCE_STRENGTH[e.kind] ?? 0));
  if (strongest >= EVIDENCE_STRENGTH.email_exact) return 'known';
  // One candidate on weak evidence is a question, not an answer.
  return strongest >= EVIDENCE_STRENGTH.name_canonical ? 'ambiguous' : 'unknown';
}
