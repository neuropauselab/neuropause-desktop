/**
 * ENG-09 — the pilot surface is MOUNTED CONDITIONALLY.
 *
 * NP-007 and NP-008 both measured the same line: `app.use('/pilot', requireAuth,
 * createPilotRouter())`, with no condition of any kind. So the pilot routes existed wherever
 * the process existed, and D10's "PILOT-ISOLATED" could only ever have been a deployment
 * convention.
 *
 * §11 THE MODEL: APPLICATION RUNNING != PILOT ENABLED.
 *
 * Three conditions, ALL required, evaluated at boot:
 *
 *   1. PILOT_MODULE_ENABLED === 'true'   an explicit opt-in, not a class check
 *   2. environment_class === 'PILOT'     from configuration
 *   3. the DATABASE asserts the same identity   (ENV-02's two-sided check)
 *
 * §11 "A production-like configuration must NOT be able to activate pilot routes simply by
 * setting a string" - and that is exactly what condition 3 prevents. Setting
 * PILOT_ENVIRONMENT_CLASS=PILOT on a production deployment satisfies 1 and 2 and still fails,
 * because the production database carries no `pilot_environment_identity` row and cannot be
 * made to assert one by any amount of configuration.
 *
 * WHY A SEPARATE FLAG AT ALL, given condition 3 is the strong one: because a pilot database
 * restored into a non-pilot context would otherwise re-enable the surface silently. Two keys,
 * one held by configuration and one by the data, and neither alone is enough.
 */
import type { Express, RequestHandler, Router } from 'express';
import { resolvePilotEnvironment, type EnvironmentRefusal, type PilotEnvironmentRecord } from './environment';

export type MountRefusal = EnvironmentRefusal | 'PILOT_MODULE_NOT_ENABLED';

export type MountDecision =
  | { readonly mounted: true; readonly record: PilotEnvironmentRecord }
  | { readonly mounted: false; readonly reason: MountRefusal };

/**
 * Decide whether the pilot surface may be mounted. FAIL-CLOSED AT EVERY STEP.
 *
 * §38's rule from NP-008 applies here too and is worth restating because it is the easiest
 * thing to get wrong: a MISSING value is never a yes. `PILOT_MODULE_ENABLED` must equal the
 * literal string 'true'; unset, empty, '1', 'yes' and 'TRUE' are all refusals. A permissive
 * truthiness check is how a deployment enables a pilot by accident.
 */
export async function decidePilotMount(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MountDecision> {
  if (env.PILOT_MODULE_ENABLED?.trim() !== 'true')
    return { mounted: false, reason: 'PILOT_MODULE_NOT_ENABLED' };

  const resolved = await resolvePilotEnvironment(env);
  if (!resolved.ok) return { mounted: false, reason: resolved.reason };
  return { mounted: true, record: resolved.record };
}

/**
 * Mount the pilot surface if and only if the decision permits it.
 *
 * WHEN REFUSED, NOTHING IS REGISTERED AT ALL — not a 403 handler, not a stub. The path simply
 * does not exist, and the application's ordinary 404 answers it.
 *
 * `createApp()` is synchronous and this check needs a database read, so the SHIPPING
 * application uses `createPilotMountGate` below instead. The two are the same decision with
 * different timing, and the gate is written so that a refusal is indistinguishable from an
 * unregistered path: it hands control back to the 404 handler without touching the router.
 *
 * The decision is returned so a caller can record it as evidence. It is NOT logged here: this
 * file lives in `src/pilot/`, where the standing source invariant forbids any logging path.
 */
export async function mountPilotIfEnabled(
  app: Express,
  requireAuth: RequestHandler,
  makeRouter: () => Router,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MountDecision> {
  const decision = await decidePilotMount(env);
  if (decision.mounted) app.use('/pilot', requireAuth, makeRouter());
  return decision;
}


/**
 * The gate the shipping application uses, because `createApp()` is synchronous.
 *
 * The decision needs a database read, so it is evaluated on the FIRST request and memoized —
 * boot semantics, deferred. A refusal calls `next('router')`, which abandons the entire
 * `/pilot` stack before `requireAuth` or any handler runs, and the application's ordinary 404
 * answers. An unauthenticated prober therefore cannot distinguish a deployment that refuses
 * the pilot from one that has never heard of it.
 *
 * FAIL-CLOSED ON ERROR TOO: if the decision itself throws (database unreachable, for example)
 * the gate refuses. An outage is not permission.
 */
export function createPilotMountGate(
  env: NodeJS.ProcessEnv = process.env,
): RequestHandler & { decision: () => MountDecision | null } {
  let cached: MountDecision | null = null;
  let inflight: Promise<MountDecision> | null = null;

  const resolve = async (): Promise<MountDecision> => {
    if (cached) return cached;
    inflight ??= decidePilotMount(env).catch(
      (): MountDecision => ({ mounted: false, reason: 'TARGET_IDENTITY_ABSENT' }),
    );
    cached = await inflight;
    return cached;
  };

  const gate: RequestHandler = (_req, _res, next) => {
    void resolve().then((d) => {
      if (d.mounted) next();
      else next('router');   // abandon the /pilot stack entirely -> ordinary 404
    });
  };
  return Object.assign(gate, { decision: () => cached });
}
