/**
 * API Gateway (NCEA 10.2) — FOUNDATION.
 *
 * A transport-agnostic request router: versioned routes, an authorization guard
 * (public vs authenticated, plus optional roles), token-bucket rate limiting, a
 * per-request trace id (Principle 7), and an audit hook. It does not bind a real
 * HTTP server/TLS — that is the follow-up (STATUS.md). The point is that every
 * route decision (allow/deny) and its trace are made HERE, consistently, and can
 * be fed to Audit Federation.
 */
import type { ApiResponse } from '@neuropause/shared-cloud';
import { contentId } from '../../lib/ids';
import type { RateLimiter } from './rateLimiter';

export type AuthPolicy = 'public' | 'authenticated';

export interface RouteContext {
  authenticated: boolean;
  roles: string[];
}

export interface RouteDef {
  version: string;
  method: string;
  path: string;
  policy: AuthPolicy;
  roles?: string[];
  handler: (body: unknown, ctx: RouteContext) => unknown;
}

export interface GatewayRequest {
  version: string;
  method: string;
  path: string;
  body?: unknown;
  ctx: RouteContext;
  rateKey?: string;
}

export type AuditHook = (info: {
  traceId: string;
  method: string;
  path: string;
  version: string;
  authenticated: boolean;
  status: number;
}) => void;

export class Gateway {
  private readonly routes: RouteDef[] = [];
  private seq = 0;

  constructor(
    private readonly limiter?: RateLimiter,
    private readonly onAudit?: AuditHook,
  ) {}

  register(def: RouteDef): this {
    this.routes.push(def);
    return this;
  }

  handle(req: GatewayRequest): ApiResponse<unknown> {
    const traceId = contentId('trace', req.method, req.path, ++this.seq);
    const audit = (status: number): void =>
      this.onAudit?.({
        traceId,
        method: req.method,
        path: req.path,
        version: req.version,
        authenticated: req.ctx.authenticated,
        status,
      });

    if (this.limiter && !this.limiter.allow(req.rateKey ?? `${req.ctx.authenticated}:${req.path}`)) {
      audit(429);
      return { ok: false, error: { code: 'rate_limited', message: 'too many requests' }, traceId };
    }

    const route = this.routes.find(
      (r) => r.version === req.version && r.method === req.method && r.path === req.path,
    );
    if (!route) {
      audit(404);
      return { ok: false, error: { code: 'not_found', message: 'no such route' }, traceId };
    }
    if (route.policy === 'authenticated' && !req.ctx.authenticated) {
      audit(401);
      return { ok: false, error: { code: 'unauthorized', message: 'authentication required' }, traceId };
    }
    if (route.roles && route.roles.length > 0 && !route.roles.some((r) => req.ctx.roles.includes(r))) {
      audit(403);
      return { ok: false, error: { code: 'forbidden', message: 'insufficient role' }, traceId };
    }

    const data = route.handler(req.body, req.ctx);
    audit(200);
    return { ok: true, data, traceId };
  }
}
