/**
 * PARTICIPANT DATA EXPORT - the pilot's own contribution to `GET /auth/export`.
 *
 * NP-PILOT-FIRST-005 measured the existing export and found it reads six tables and **none of
 * the seven pilot tables**. A participant asking for their data received nothing about their
 * consent, their participation, their activity, their own feedback, or their own withdrawal.
 *
 * THE DESIGN RULE HERE IS THE INTERESTING PART: WHAT IS WITHHELD IS DECLARED.
 *
 * Some pilot records about a participant were written BY SOMEONE ELSE - an operator's
 * termination reason, an operator's recorded decision, the identity of the human who acted.
 * Whether a participant may read those is a disclosure question no human has answered
 * (decisions/HUMAN-DECISION-G5-TERMINATION-POLICY.md, HUMAN-DECISION-G2-AUTHORITY.md), so this
 * export does not answer it either: the field is present, its value is null, and `withheld`
 * names the decision that governs it.
 *
 * That is deliberately not the same as omitting it. An export that silently drops a field
 * tells the reader nothing existed; this one tells them something exists and is not being
 * shown, and why. A participant who needs it knows what to ask for, and a reviewer can see
 * exactly which decisions are load-bearing.
 *
 * DELIBERATELY EXCLUDED ENTIRELY: `pilot_control`. It is the programme's own state - who
 * stopped the pilot, their reason, and the capacity cap - and it is no participant's personal
 * data. It is not withheld-pending-decision; it simply does not belong in a personal export.
 */
import type { PilotRepository } from './repository';

export interface ParticipantPilotExport {
  /** What this participant agreed to, and the document identity behind it. */
  consent: {
    recorded: boolean;
    version: string | null;
    at: string | null;
    termsId: string | null;
    termsDigest: string | null;
    /** The published document the consent binds to, when the registry holds it. */
    terms: { version: string; status: string; digest: string; contentReference: string; publishedAt: string | null } | null;
  };
  enrollment: { recorded: boolean; state: string | null; startedAt: string | null; updatedAt: string | null };
  /** Everything this participant's own activity produced, including their free-text feedback. */
  events: Array<{ eventType: string; metadata: Record<string, unknown>; createdAt: string }>;
  /**
   * Lifecycle transitions about this participation. A WITHDRAWAL is the participant's own act
   * and is exported whole; a TERMINATION was written by an operator, so its reason and actor
   * are withheld pending a decision.
   */
  lifecycle: Array<{
    kind: string;
    previousState: string;
    newState: string;
    at: string;
    reason: string | null;
    actorUserId: string | null;
    selfInitiated: boolean;
  }>;
  /** A human decision recorded about this participation, if any. */
  decision: { recorded: boolean; at: string | null; decision: string | null; reason: string | null; actorId: string | null };
  /** Every field deliberately not populated, with the decision that governs it. */
  withheld: string[];
}

const WITHHELD_TERMINATION =
  'pilot_lifecycle_events.reason and .actor_user_id for TERMINATION rows - whether a participant ' +
  'may read the operator reason, and learn which human ended their participation, is undecided ' +
  '(decisions/HUMAN-DECISION-G5-TERMINATION-POLICY.md: REASON_DISCLOSURE)';

const WITHHELD_DECISION =
  'human_decisions.decision, .reason and .actor_id - whether an operator decision recorded about ' +
  'a participant is disclosed to them is undecided (decisions/HUMAN-DECISION-G2-AUTHORITY.md). ' +
  'Note also that human_decisions.subject is free text and may name a third party, so it is not ' +
  'exported in any form';

/**
 * Assemble one participant's pilot data. READ-ONLY: every call here is a repository read, and
 * this module writes nothing.
 */
export async function exportParticipantPilotData(
  repo: PilotRepository,
  userId: string,
): Promise<ParticipantPilotExport> {
  const enrollment = await repo.getEnrollment(userId);
  // The consent this participation is BOUND to, not merely the account's most recent one —
  // see readBack.ts for why those are different questions. `latestConsent` still answers the
  // no-enrollment case, where nothing is bound.
  const consent = enrollment
    ? await repo.findConsentById(enrollment.consentId)
    : await repo.latestConsent(userId);
  const events = enrollment ? await repo.listEvents(enrollment.id) : [];
  const transitions = enrollment ? await repo.listLifecycleEvents(enrollment.id) : [];
  const decision = enrollment?.decisionId ? await repo.findDecision(enrollment.decisionId) : null;
  const terms = consent?.version ? await repo.findTerms(consent.version) : null;

  const withheld: string[] = [];
  const lifecycle = transitions.map((t) => {
    // A withdrawal is the participant's own act, so their own reason is theirs to receive.
    const selfInitiated = t.kind === 'WITHDRAWAL' && t.actorUserId === userId;
    if (!selfInitiated && !withheld.includes(WITHHELD_TERMINATION)) withheld.push(WITHHELD_TERMINATION);
    return {
      kind: t.kind,
      previousState: t.previousState,
      newState: t.newState,
      at: t.createdAt,
      reason: selfInitiated ? t.reason : null,
      actorUserId: selfInitiated ? t.actorUserId : null,
      selfInitiated,
    };
  });

  if (decision) withheld.push(WITHHELD_DECISION);

  return {
    consent: {
      recorded: consent !== null,
      version: consent?.version ?? null,
      at: consent?.createdAt ?? null,
      termsId: consent?.termsId ?? null,
      termsDigest: consent?.termsDigest ?? null,
      terms: terms
        ? {
            version: terms.version,
            status: terms.status,
            digest: terms.digest,
            contentReference: terms.contentReference,
            publishedAt: terms.publishedAt,
          }
        : null,
    },
    enrollment: {
      recorded: enrollment !== null,
      state: enrollment?.state ?? null,
      startedAt: enrollment?.startedAt ?? null,
      updatedAt: enrollment?.updatedAt ?? null,
    },
    events: events.map((e) => ({ eventType: e.eventType, metadata: e.metadata, createdAt: e.createdAt })),
    lifecycle,
    // The decision's EXISTENCE and TIME are facts about this participation and are disclosed;
    // its content was written by another human and is not.
    decision: {
      recorded: decision !== null,
      at: decision?.createdAt ?? null,
      decision: null,
      reason: null,
      actorId: null,
    },
    withheld,
  };
}
