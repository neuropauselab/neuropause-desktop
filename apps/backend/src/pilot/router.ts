/**
 * Pilot HTTP API (mounted at /pilot behind requireAuth). Auth-agnostic like the
 * devices router: reads req.userId, maps PilotError codes to HTTP.
 *
 * Routes:
 *   POST /pilot/consent   { version }                     record consent
 *   POST /pilot/enroll                                    enroll (consent required)
 *   GET  /pilot/status                                    lifecycle status + day
 *   POST /pilot/events    { eventType, metadata? }        append a pilot event
 *   GET  /pilot/day7                                      Day-7 measurement report
 *   POST /pilot/decision  { targetState, decision, reason, subjectUserId? }
 *                                                         record a HUMAN decision
 *                                                         (sole path to outcome states)
 *
 *   NP-PILOT-FIRST-004 added the five routes below. The three authority-gated ones create no
 *   authority: production supplies no evaluator, so each is refused with zero writes until a
 *   human designation (MR-04) exists.
 *
 *   POST /pilot/withdraw  { reason }                      C-03 leave your OWN participation
 *                                                         (NOT authority-gated, deliberately)
 *   POST /pilot/terminate { subjectUserId, reason }       C-03 end ANOTHER participation
 *                                                         (authority-gated)
 *   POST /pilot/stop      { reason }                      C-04 stop the PILOT, not the service
 *                                                         (authority-gated)
 *   POST /pilot/resume    { reason }                      C-04 resume; a SEPARATE authority
 *                                                         question from stop
 *   GET  /pilot/control                                   whether the pilot is stopped
 *                                                         (actor/reason/cap need authority)
 *   GET  /pilot/terms                                     the PUBLISHED terms, so a surface
 *                                                         never invents a version string
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { AppError, unauthorized } from '../middleware/error';
import { PilotError, type PilotErrorCode } from './types';
import { sqlPilotRepository } from './repository';
import type { PilotServiceDeps } from './service';
import {
  advanceMachineStates, applyHumanDecision, day7Report, enroll, pilotControl, recordConsent,
  recordEvent, publishedTerms, resumePilot, status, stopPilot, terminateParticipation, withdraw,
} from './service';

const STATUS: Record<PilotErrorCode, number> = {
  consent_required: 409,
  already_enrolled: 409,
  not_enrolled: 404,
  invalid_event: 400,
  human_decision_required: 403,
  invalid_decision: 400,
  // NP-PILOT-FIRST-004
  terms_unknown: 409,
  terms_not_published: 409,
  consent_not_bound: 409,
  pilot_stopped: 409,
  enrollment_boundary_undecided: 409,
  enrollment_full: 409,
  already_exited: 409,
};

const ConsentBody = z.object({ version: z.string().min(1).max(64) });
const EventBody = z.object({ eventType: z.string().min(1).max(64), metadata: z.record(z.unknown()).optional() });
const DecisionBody = z.object({
  targetState: z.string().min(1).max(64),
  decision: z.string().min(1).max(500),
  reason: z.string().min(1).max(2000),
  /**
   * The participant the decision is ABOUT. Optional; absent means the caller.
   *
   * Before this field existed the route passed `uid(req)` as both actor and subject, so a
   * decision about ANOTHER participant was unreachable through the production API — an
   * operator could never record an outcome for anyone. NP-PILOT-FIRST-003 recorded that as
   * C-02.
   *
   * THIS FIELD CREATES NO AUTHORITY. `applyHumanDecision` asks `resolveAuthority` BEFORE any
   * repository read, production supplies no evaluator, so the answer is UNKNOWN and every
   * caller is refused with zero writes — separated or not. Supplying a subject is a
   * SEPARATION property; permission still requires a designated evaluator (MR-04).
   */
  /**
   * Constrained to a UUID because `pilot_enrollments.user_id` and `users.id` are `uuid`.
   * Not a security fix - the authority gate refuses first, and the value is always a bound
   * parameter - but after a designation exists a non-UUID subject would reach Postgres and
   * surface as 22P02, i.e. a 500 where a clean 404 belongs.
   */
  subjectUserId: z.string().uuid().optional(),
});
const ReasonBody = z.object({ reason: z.string().min(1).max(2000) });
const TerminateBody = z.object({ subjectUserId: z.string().uuid(), reason: z.string().min(1).max(2000) });

function toHttp(err: unknown): never {
  if (err instanceof PilotError) throw new AppError(STATUS[err.code], `pilot_${err.code}`, err.message);
  throw err;
}

type H = (req: Request, res: Response) => Promise<void>;
const h =
  (fn: H) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      toHttp(err);
    }
  };

export function createPilotRouter(deps: PilotServiceDeps = { repo: sqlPilotRepository }): Router {
  const router = Router();
  const uid = (req: Request): string => {
    if (!req.userId) throw unauthorized('unauthorized', 'Authentication required.');
    return req.userId;
  };

  router.post(
    '/consent',
    validateBody(ConsentBody),
    h(async (req, res) => {
      const { version } = req.body as z.infer<typeof ConsentBody>;
      res.status(201).json({ consent: await recordConsent(deps, uid(req), version) });
    }),
  );

  router.post(
    '/enroll',
    h(async (req, res) => {
      res.status(201).json({ enrollment: await enroll(deps, uid(req)) });
    }),
  );

  router.get(
    '/status',
    h(async (req, res) => {
      await advanceMachineStates(deps, uid(req));
      res.json(await status(deps, uid(req)));
    }),
  );

  router.post(
    '/events',
    validateBody(EventBody),
    h(async (req, res) => {
      const { eventType, metadata } = req.body as z.infer<typeof EventBody>;
      res.status(201).json({ event: await recordEvent(deps, uid(req), eventType, metadata ?? {}) });
    }),
  );

  router.get(
    '/day7',
    h(async (req, res) => {
      res.json(await day7Report(deps, uid(req)));
    }),
  );

  router.post(
    '/decision',
    validateBody(DecisionBody),
    h(async (req, res) => {
      const { targetState, decision, reason, subjectUserId } = req.body as z.infer<typeof DecisionBody>;
      // Actor and subject are now passed SEPARATELY. The subject defaults to the caller so
      // that the pre-existing self-decision shape is unchanged; the authority predicate — not
      // the shape of this call — decides whether anything is written.
      const actor = uid(req);
      const subject = subjectUserId ?? actor;
      res.status(201).json(await applyHumanDecision(deps, actor, subject, targetState, decision, reason));
    }),
  );

  // C-03 — a participant leaves their OWN participation. Not authority-gated: requiring a
  // designated operator to let someone leave would make withdrawal unavailable for exactly
  // as long as the designation is missing.
  router.post(
    '/withdraw',
    validateBody(ReasonBody),
    h(async (req, res) => {
      const { reason } = req.body as z.infer<typeof ReasonBody>;
      res.status(201).json(await withdraw(deps, uid(req), reason));
    }),
  );

  // C-03 — an operator ends ANOTHER participant's participation. Authority-gated.
  router.post(
    '/terminate',
    validateBody(TerminateBody),
    h(async (req, res) => {
      const { subjectUserId, reason } = req.body as z.infer<typeof TerminateBody>;
      res.status(201).json(await terminateParticipation(deps, uid(req), subjectUserId, reason));
    }),
  );

  // C-04 — pilot-scoped stop and resume. Separate authority questions, so recovery is never
  // an accident of the stop path.
  router.post(
    '/stop',
    validateBody(ReasonBody),
    h(async (req, res) => {
      const { reason } = req.body as z.infer<typeof ReasonBody>;
      res.status(201).json({ control: await stopPilot(deps, uid(req), reason) });
    }),
  );
  router.post(
    '/resume',
    validateBody(ReasonBody),
    h(async (req, res) => {
      const { reason } = req.body as z.infer<typeof ReasonBody>;
      res.status(201).json({ control: await resumePilot(deps, uid(req), reason) });
    }),
  );
  // Redacted for an ordinary caller: `stopped` only. The full row - actor, reason, time and
  // the participant cap - requires authority, and production designates none.
  router.get('/control', h(async (req, res) => { res.json({ control: await pilotControl(deps, uid(req)) }); }));

  // C-05 — what a participant may be asked to agree to. The registry ships EMPTY, so this
  // answers `[]` and an honest surface offers no consent button. A surface that hard-codes a
  // version instead of reading this is presenting a placeholder as operative consent.
  router.get('/terms', h(async (_req, res) => { res.json({ terms: await publishedTerms(deps) }); }));

  return router;
}
