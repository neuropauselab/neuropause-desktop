/**
 * Enterprise REST API dispatcher (P3.0, Increment 1).
 *
 * One entrypoint, `handleEnterpriseApiRequest`, composes three existing pieces —
 * it does not re-implement any of them:
 *   1. route match           → which existing channel + required scope,
 *   2. the Ecosystem gateway  → auth (API key) + scope + rate + quota + version + audit,
 *   3. the secure-handler core → RBAC permission + Zod + the existing handler.
 *
 * The result is wrapped in the public envelope with the same rate/quota/version
 * headers the SDK already reads. Pure over its injected deps, so it unit-tests with
 * fakes; the runtime wires the real gateway + handler registry.
 */
import type {
  ApiRouteInfo,
  ApiVersion,
  EnterpriseApiRequest,
  EnterpriseApiResponse,
  GatewayAuditEntry,
  GatewayDecision,
  GatewayRequestInput,
  IpcChannelName,
  SystemHealthSnapshot,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { ENTERPRISE_API_ROUTES } from './routeRegistry';
import { matchRoute, normalizePath, paginateAndSort, parseListControls } from './apiRouter';
import type { RouteContext, SpecialRouteDeps } from './types';

const log = createLogger('enterprise-api-gateway');

/** Client-safe message for a 5xx — never leak internal error text/channel names. */
function safeServerMessage(status: number): string {
  return status === 504 ? 'Upstream timed out' : 'Internal server error';
}

export interface ApiGatewayDeps {
  /** The existing Ecosystem gateway: resolve key → decide → meter → audit. */
  decide: (input: GatewayRequestInput) => GatewayDecision;
  /** Look up an existing secure handler by channel. */
  resolveHandler: (channel: IpcChannelName) => SecureHandlerDef | undefined;
  /** Run an existing handler through the shared secure core (RBAC + Zod + handler). */
  runHandler: (def: SecureHandlerDef, payload: unknown) => Promise<unknown>;
  /** Gateway request metrics (reused from the Ecosystem gateway store). */
  metrics: (windowDays: number) => unknown;
  /** Recent gateway audit entries, newest first (reused for observability traces/logs). */
  gatewayAudit: (limit: number) => GatewayAuditEntry[];
  /** The live NeuroCore system-health snapshot (reused for observability health/metrics). */
  health: () => Promise<SystemHealthSnapshot>;
  now: () => number;
}

function headersFrom(d: GatewayDecision): Record<string, string> {
  const h: Record<string, string> = {
    'x-ratelimit-remaining': String(Math.max(0, d.rateRemaining)),
    'x-ratelimit-limit': String(d.rateLimit),
    'x-quota-remaining': String(Math.max(0, d.quotaRemaining)),
    'x-api-version': d.version,
  };
  if (d.retryAfterMs != null) h['retry-after'] = String(Math.ceil(d.retryAfterMs / 1000));
  return h;
}

/** Map a thrown handler/validation error onto an HTTP status. */
function statusFromError(msg: string): number {
  if (/invalid request/i.test(msg)) return 400;
  if (/sign in|authoriz|permission|not available/i.test(msg)) return 403;
  if (/timed out/i.test(msg)) return 504;
  return 500;
}

function cleanPayload(p: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
}

export async function handleEnterpriseApiRequest(
  req: EnterpriseApiRequest,
  deps: ApiGatewayDeps,
): Promise<EnterpriseApiResponse> {
  const version: ApiVersion = req.version ?? 'v1';
  const method = req.method.toUpperCase();
  const path = normalizePath(req.path);
  const matched = matchRoute(ENTERPRISE_API_ROUTES, method, path);

  if (!matched) {
    return { status: 404, ok: false, error: `No route for ${method} ${path}`, headers: { 'x-api-version': version } };
  }
  const { route, params } = matched;

  // Gateway decision (reuses runGateway — auth/scope/rate/quota/version + audit + metering).
  const decision = deps.decide({ apiKey: req.apiKey ?? null, method, path, version, scope: route.scope });
  const headers = headersFrom(decision);
  if (!decision.allowed) {
    return { status: decision.status, ok: false, error: decision.reason, headers };
  }

  const controls = parseListControls(req.query ?? {});
  const ctx: RouteContext = { params, query: req.query ?? {}, body: req.body, controls };

  try {
    if (route.kind === 'special') {
      const specialDeps: SpecialRouteDeps = {
        dispatch: async (channel, payload) => {
          const def = deps.resolveHandler(channel);
          if (!def) throw new Error(`Route channel ${channel} is not wired`);
          return deps.runHandler(def, cleanPayload(payload));
        },
        metrics: deps.metrics,
        gatewayAudit: deps.gatewayAudit,
        health: deps.health,
        routeCount: ENTERPRISE_API_ROUTES.length,
        version,
        now: deps.now,
      };
      const data = await route.run(ctx, specialDeps);
      return { status: 200, ok: true, data, headers };
    }

    const def = deps.resolveHandler(route.channel);
    if (!def) {
      log.error('Route is not wired to a handler', { path: route.path, channel: route.channel });
      return { status: 500, ok: false, error: safeServerMessage(500), headers };
    }
    const result = await deps.runHandler(def, cleanPayload(route.buildPayload(ctx)));

    if (route.kind === 'list') {
      const arr = route.extract ? route.extract(result) : Array.isArray(result) ? result : [];
      return { status: 200, ok: true, data: paginateAndSort(arr, controls), headers };
    }
    return { status: 200, ok: true, data: result, headers };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error';
    const status = statusFromError(msg);
    // 4xx are user-actionable (validation / auth / scope) and safe to return; 5xx could
    // carry internal detail (channel names, stack messages) — log it, return a generic body.
    if (status >= 500) {
      log.warn('Enterprise API handler error', { method, path, status, error: msg });
      return { status, ok: false, error: safeServerMessage(status), headers };
    }
    return { status, ok: false, error: msg, headers };
  }
}

/** The public route index (drives docs + the OpenAPI generator in Increment 2). */
export function enterpriseApiRouteIndex(): ApiRouteInfo[] {
  return ENTERPRISE_API_ROUTES.map((r) => ({
    method: r.method,
    path: r.path,
    scope: r.scope,
    summary: r.summary,
    list: r.list,
  }));
}
