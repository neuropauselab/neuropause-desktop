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
 *   POST /pilot/decision  { targetState, decision, reason } record a HUMAN decision
 *                                                         (sole path to outcome states)
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { AppError, unauthorized } from '../middleware/error';
import { PilotError, type PilotErrorCode } from './types';
import { sqlPilotRepository } from './repository';
import type { PilotServiceDeps } from './service';
import { advanceMachineStates, applyHumanDecision, day7Report, enroll, recordConsent, recordEvent, status } from './service';

const STATUS: Record<PilotErrorCode, number> = {
  consent_required: 409,
  already_enrolled: 409,
  not_enrolled: 404,
  invalid_event: 400,
  human_decision_required: 403,
  invalid_decision: 400,
};

const ConsentBody = z.object({ version: z.string().min(1).max(64) });
const EventBody = z.object({ eventType: z.string().min(1).max(64), metadata: z.record(z.unknown()).optional() });
const DecisionBody = z.object({
  targetState: z.string().min(1).max(64),
  decision: z.string().min(1).max(500),
  reason: z.string().min(1).max(2000),
});

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
      const { targetState, decision, reason } = req.body as z.infer<typeof DecisionBody>;
      res.status(201).json(await applyHumanDecision(deps, uid(req), uid(req), targetState, decision, reason));
    }),
  );

  return router;
}
