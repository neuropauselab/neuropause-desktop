/**
 * AI gateway HTTP surface. Mounted at /ai behind requireAuth (see app.ts).
 *
 *   GET  /ai/status   → { configured, provider, model, gateway } — no secrets
 *   POST /ai/chat     → GatewayResponse (text + tool_proposals; never executes)
 *
 * Per-user rate limit (in-process sliding window, AI_GATEWAY_USER_RPM, default 30)
 * on top of the per-IP limiter mounted in app.ts. Every call writes one audit
 * line: request id, user id, provider, model, token counts, proposal count —
 * never prompt or completion bodies.
 */
import { Router, type Request, type Response } from 'express';
import { logger } from '../config/logger';
import { recordAiGateway } from '../observability/metrics';
import { GatewayError, assertNoAuthorityClaim, completeViaProvider, gatewayConfigFromEnv, gatewayConfigured, validateRequest, type GatewayConfig, type GatewayRequest, type GatewayResponse } from './gateway';

export interface AiGatewayDeps {
  config?: GatewayConfig;
  fetchImpl?: typeof fetch;
  /** Injectable completion for tests (bypasses the provider). */
  complete?: (cfg: GatewayConfig, req: GatewayRequest) => Promise<GatewayResponse>;
  userRpm?: number;
  now?: () => number;
}

class UserWindow {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly now: () => number) {}
  take(userId: string): { ok: boolean; retryAfterSeconds: number } {
    const t = this.now();
    const arr = (this.hits.get(userId) ?? []).filter((x) => t - x < 60_000);
    if (arr.length >= this.limit) { this.hits.set(userId, arr); return { ok: false, retryAfterSeconds: Math.ceil((60_000 - (t - arr[0])) / 1000) }; }
    arr.push(t); this.hits.set(userId, arr);
    if (this.hits.size > 50_000) this.hits.clear();
    return { ok: true, retryAfterSeconds: 0 };
  }
}

export function createAiGatewayRouter(deps: AiGatewayDeps = {}): Router {
  const router = Router();
  const cfg = deps.config ?? gatewayConfigFromEnv();
  const complete = deps.complete ?? ((c: GatewayConfig, r: GatewayRequest) => completeViaProvider(c, r, deps.fetchImpl));
  const window = new UserWindow(deps.userRpm ?? Number(process.env.AI_GATEWAY_USER_RPM ?? 30), deps.now ?? (() => Date.now()));

  router.get('/status', (_req: Request, res: Response) => {
    res.json({ configured: gatewayConfigured(cfg), provider: cfg.provider, model: gatewayConfigured(cfg) ? cfg.model : null, gateway: { version: 'np.ai.gateway/v1', policy: 'AI_PROPOSES_ONLY', executes_tools: false, grants_authority: false }, limits: { max_messages: cfg.maxMessages, max_input_chars: cfg.maxInputChars, max_output_tokens: cfg.maxOutputTokens, timeout_ms: cfg.timeoutMs } });
  });

  router.post('/chat', async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) { res.status(401).json({ error: 'unauthorized', message: 'Authentication required.' }); return; }
    const rl = window.take(userId);
    if (!rl.ok) { recordAiGateway(cfg.provider, 'rate_limited', 0); res.set('retry-after', String(rl.retryAfterSeconds)); res.status(429).json({ error: 'rate_limited', message: 'Too many AI requests; slow down.', retryAfterSeconds: rl.retryAfterSeconds }); return; }
    const started = Date.now();
    try {
      const body = validateRequest(cfg, req.body);
      const out = assertNoAuthorityClaim(await complete(cfg, body));
      recordAiGateway(out.provider, 'ok', out.latency_ms, out.usage.input_tokens, out.usage.output_tokens);
      logger.info({ requestId: (req as Request & { id?: string }).id, userId, provider: out.provider, model: out.model, input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens, proposals: out.tool_proposals.length, finish: out.finish_reason, ms: Date.now() - started }, 'ai_gateway.chat');
      res.json(out);
    } catch (err) {
      if (err instanceof GatewayError) {
        recordAiGateway(cfg.provider, err.status >= 500 ? 'error' : 'refused', Date.now() - started);
        logger.warn({ userId, code: err.code, status: err.status, ms: Date.now() - started }, 'ai_gateway.refused');
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      recordAiGateway(cfg.provider, 'error', Date.now() - started);
      logger.error({ userId, err: (err as Error).message }, 'ai_gateway.error');
      res.status(500).json({ error: 'gateway_error', message: 'The AI gateway failed.' });
    }
  });
  return router;
}
