/**
 * G7 — PARTICIPATION READ-BACK: reconstruct one participation SOLELY from recorded evidence.
 *
 * NP-PILOT-FIRST-004 §11 asks a question the pilot could not previously answer: take a
 * participant, use nothing but what the system durably recorded, and say what happened to
 * them. Not what the API returned at the time — what the rows say afterwards.
 *
 * THE DISCIPLINE, and it is the whole point of the module:
 *
 *   1. IT READS, IT NEVER WRITES. Nothing here can change a state, and no function here is
 *      an authority. A read-back that could repair what it reads would be an oracle marking
 *      its own homework.
 *
 *   2. IT IS SUPPLIED ONLY A REPOSITORY. It takes no in-memory handle to the objects the
 *      service returned, so a reconstruction cannot accidentally be corroborated by the
 *      very call that produced it. Feed it a repository reading persisted rows and the
 *      reconstruction is independent of the process that wrote them.
 *
 *   3. IT NEVER INFERS WHAT WAS NOT RECORDED. Where the evidence is silent the answer is
 *      `notRecorded`, listing the fact by name. A reconstruction that filled a gap with a
 *      plausible value would be the most dangerous artefact in the pilot: it would read as
 *      evidence while being a guess.
 *
 *   4. A STATE IS NEVER TRUSTED OVER ITS OWN EVIDENCE. Where `pilot_enrollments.state` and
 *      the lifecycle ledger disagree, the reconstruction reports a DEVIATION and refuses to
 *      resolve it by preference. Disagreement is a finding, not a tie to be broken.
 */
import type { PilotRepository } from './repository';
import { EXITED_STATES, HUMAN_DECISION_STATES } from './types';
import type { ConsentRecord, HumanDecision, PilotEnrollment, PilotEvent, PilotLifecycleEvent, PilotState } from './types';

/**
 * NOT_ENROLLED   no enrollment row exists for this account.
 * CONSENT_ONLY   consent is recorded and no enrollment followed.
 * IN_PILOT       enrolled, running, not exited and no human decision recorded.
 * DECIDED        an outcome state was reached through a recorded human decision.
 * EXITED         the participation ended (withdrawal, termination or completion).
 * DEVIATION      the recorded state and the recorded evidence disagree.
 */
export type ParticipationStatus =
  | 'NOT_ENROLLED' | 'CONSENT_ONLY' | 'IN_PILOT' | 'DECIDED' | 'EXITED' | 'DEVIATION';

export interface ParticipationReadBack {
  userId: string;
  status: ParticipationStatus;
  /** What the participant agreed to, and whether it binds to a terms object at all. */
  consent: {
    recorded: boolean;
    version: string | null;
    boundToTerms: boolean;
    termsVersion: string | null;
    termsStatus: string | null;
    /** The digest stored on the consent row beside the terms reference. */
    digest: string | null;
    at: string | null;
  };
  enrollment: { recorded: boolean; state: PilotState | null; startedAt: string | null; updatedAt: string | null };
  /** Activity as recorded, by type, with first and last instants. */
  activity: { count: number; types: string[]; firstAt: string | null; lastAt: string | null };
  /** Every lifecycle transition recorded for this participation, oldest first. */
  transitions: Array<Pick<PilotLifecycleEvent, 'kind' | 'previousState' | 'newState' | 'actorUserId' | 'reason' | 'createdAt'>>;
  /** The human decision behind an outcome state, resolved from its recorded id. */
  decision: { recorded: boolean; id: string | null; actorId: string | null; decision: string | null; reason: string | null; at: string | null };
  /**
   * Facts this pilot does NOT durably record, named rather than fabricated. These are
   * structural absences, not failures of this particular reconstruction.
   */
  notRecorded: string[];
  /** Disagreements between the recorded state and the recorded evidence. */
  deviations: string[];
}

/** Facts no pilot table holds today. Named here so a reader is never left to assume. */
const STRUCTURALLY_NOT_RECORDED = [
  'consent_withdrawal (withdrawing participation and withdrawing consent are not distinguished)',
  'data_export_request',
  'data_erasure_request',
  'retention_expiry',
  'participant_notification (no record that the participant was told anything)',
] as const;

export async function readBackParticipation(repo: PilotRepository, userId: string): Promise<ParticipationReadBack> {
  const consent = await repo.latestConsent(userId);
  const enrollment = await repo.getEnrollment(userId);
  const events = enrollment ? await repo.listEvents(enrollment.id) : [];
  const transitions = enrollment ? await repo.listLifecycleEvents(enrollment.id) : [];
  const decision = enrollment?.decisionId ? await repo.findDecision(enrollment.decisionId) : null;
  const terms = consent?.version ? await repo.findTerms(consent.version) : null;

  return reconstruct({ userId, consent, enrollment, events, transitions, decision, terms });
}

/** The pure rule. Every classification below is derived from these rows and nothing else. */
export function reconstruct(input: {
  userId: string;
  consent: ConsentRecord | null;
  enrollment: PilotEnrollment | null;
  events: PilotEvent[];
  transitions: PilotLifecycleEvent[];
  decision: HumanDecision | null;
  terms: { version: string; status: string } | null;
}): ParticipationReadBack {
  const { userId, consent, enrollment, decision, terms } = input;
  const events = [...input.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const transitions = [...input.transitions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const notRecorded = [...STRUCTURALLY_NOT_RECORDED] as string[];
  const deviations: string[] = [];

  if (consent && !consent.termsId)
    notRecorded.push('terms_accepted (this consent is bound to no terms object — what was agreed cannot be reconstructed)');
  if (enrollment?.decisionId && !decision)
    deviations.push(`decision ${enrollment.decisionId} is referenced by the enrollment but no decision row was found`);

  const state = enrollment?.state ?? null;
  const exited = state !== null && (EXITED_STATES as readonly string[]).includes(state);
  const decided = state !== null && (HUMAN_DECISION_STATES as readonly string[]).includes(state);
  const last = transitions.at(-1) ?? null;

  // A recorded exit must be explained by a recorded transition, and vice versa.
  if (exited && state !== 'COMPLETED' && last?.newState !== state)
    deviations.push(`state is ${state} but no lifecycle transition records reaching it`);
  if (last && !exited && (['WITHDRAWN', 'TERMINATED'] as string[]).includes(last.newState))
    deviations.push(`a ${last.kind} transition to ${last.newState} is recorded but the state is ${state}`);
  // An outcome state is reachable ONLY through a human decision; one without a decision row
  // means something wrote an outcome state by another path.
  if (decided && !enrollment?.decisionId)
    deviations.push(`state is ${state}, an outcome state, but no human decision is recorded against it`);

  let status: ParticipationStatus;
  if (deviations.length) status = 'DEVIATION';
  else if (!enrollment) status = consent ? 'CONSENT_ONLY' : 'NOT_ENROLLED';
  else if (exited) status = 'EXITED';
  else if (decided) status = 'DECIDED';
  else status = 'IN_PILOT';

  return {
    userId,
    status,
    consent: {
      recorded: consent !== null,
      version: consent?.version ?? null,
      boundToTerms: Boolean(consent?.termsId),
      termsVersion: terms?.version ?? null,
      termsStatus: terms?.status ?? null,
      digest: consent?.termsDigest ?? null,
      at: consent?.createdAt ?? null,
    },
    enrollment: {
      recorded: enrollment !== null,
      state,
      startedAt: enrollment?.startedAt ?? null,
      updatedAt: enrollment?.updatedAt ?? null,
    },
    activity: {
      count: events.length,
      types: [...new Set(events.map((e) => e.eventType))],
      firstAt: events[0]?.createdAt ?? null,
      lastAt: events.at(-1)?.createdAt ?? null,
    },
    transitions: transitions.map((t) => ({
      kind: t.kind, previousState: t.previousState, newState: t.newState,
      actorUserId: t.actorUserId, reason: t.reason, createdAt: t.createdAt,
    })),
    decision: {
      recorded: decision !== null,
      id: enrollment?.decisionId ?? null,
      actorId: decision?.actorId ?? null,
      decision: decision?.decision ?? null,
      reason: decision?.reason ?? null,
      at: decision?.createdAt ?? null,
    },
    notRecorded,
    deviations,
  };
}
