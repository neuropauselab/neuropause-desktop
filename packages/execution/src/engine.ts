/**
 * Module 2 — Connector Execution Engine. The production pipeline every execution passes
 * through: policy → HITL (AI-initiated) → rate limit → circuit breaker → transport with
 * retry/backoff/timeout → observe → govern → evidence. Failures that exhaust retries are
 * dead-lettered. Every execution is governed (audit + event) and replayable. The transport
 * is the reused integrations HttpClient — a FakeHttpClient for adapter-verified tests, a
 * real FetchHttpClient (over a local server) for the live-verified path.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import { withRetry, withTimeout, isRetryableStatus, HttpError, type HttpClient, type HttpRequest, type HttpResponse } from '@neuropause/integrations';
import type { HumanInTheLoopGate } from '@neuropause/automation';
import type { PolicyEngine } from './policy';
import type { ConnectorRateLimiter, RetryRecoveryEngine } from './reliability';
import type { ConnectorObservability } from './observability';
import type { ExternalExecutionGovernance } from './governance';
import { getOperation } from './connectors';
import { CircuitBreakerRegistry } from './circuit';
import type { UniversalConnectorRuntime } from './runtime';
import type { ExecutionRequest, ExecutionResult, EvidenceLevel, ConnectorDescriptor, OperationSpec } from './types';
import type { ExecutionOutcome } from './constants';

export interface EngineDeps {
  http: HttpClient;
  connectors: UniversalConnectorRuntime;
  policy: PolicyEngine;
  hitl: HumanInTheLoopGate;
  rateLimiter: ConnectorRateLimiter;
  recovery: RetryRecoveryEngine;
  observability: ConnectorObservability;
  governance: ExternalExecutionGovernance;
  clock: Clock;
}

export interface EngineOptions {
  maxAttempts?: number;
  timeoutMs?: number;
  tokenResolver?: (tenantId: string, connectorId: string) => Promise<string | undefined>;
}

const safeParse = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

export class ConnectorExecutionEngine {
  private readonly breakers: CircuitBreakerRegistry;
  private readonly executions: Array<{ result: ExecutionResult; request: ExecutionRequest }> = [];
  private readonly maxAttempts: number;
  private readonly timeoutMs: number | undefined;

  constructor(
    private readonly deps: EngineDeps,
    private readonly options: EngineOptions = {},
  ) {
    this.breakers = new CircuitBreakerRegistry(deps.clock);
    this.maxAttempts = options.maxAttempts ?? 3;
    this.timeoutMs = options.timeoutMs;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const start = this.deps.clock.now();
    const requestHash = sha256Hex(JSON.stringify({ c: req.connectorId, o: req.operation, p: req.params ?? {}, q: req.query ?? {} }));

    const connector = this.deps.connectors.get(req.connectorId);
    if (!connector) return this.finalize(req, 'infra-pending', 'failed', requestHash, start, { error: `unknown connector '${req.connectorId}'` });
    const opSpec = getOperation(connector, req.operation);
    if (!opSpec) return this.finalize(req, connector.evidence, 'failed', requestHash, start, { error: `unknown operation '${req.operation}'` });

    // 1. policy enforcement
    const decision = this.deps.policy.evaluate({ tenantId: req.tenantId, connectorId: req.connectorId, operation: req.operation, ...(opSpec.riskTier ? { riskTier: opSpec.riskTier } : {}), ...(opSpec.mutating ? { mutating: true } : {}) });
    if (decision.effect === 'deny') return this.finalize(req, connector.evidence, 'denied', requestHash, start, { error: decision.reason });

    // 2. human-in-the-loop for AI-initiated actions (Wave 4 gate, reused)
    if (req.aiInitiated) {
      const guard = this.deps.hitl.guard({ operation: opSpec.mutating ? 'execute-high-risk' : 'suggest-action', aiInitiated: true, ...(req.approved ? { humanApproved: true } : {}) });
      if (!guard.allowed) return this.finalize(req, connector.evidence, 'awaiting-approval', requestHash, start, { error: guard.reason });
    }
    if (decision.effect === 'require-approval' && !req.approved) {
      return this.finalize(req, connector.evidence, 'awaiting-approval', requestHash, start, { error: decision.reason });
    }

    // 3. rate limit
    if (!this.deps.rateLimiter.allow(req.tenantId, req.connectorId)) return this.finalize(req, connector.evidence, 'rate-limited', requestHash, start, {});

    // 4. circuit breaker
    const breaker = this.breakers.get(req.connectorId);
    if (!breaker.allow()) return this.finalize(req, connector.evidence, 'circuit-open', requestHash, start, {});

    // 5. execute over the transport with retry + timeout
    const httpReq = await this.buildRequest(connector, opSpec, req);
    let attempts = 0;
    let res: HttpResponse;
    try {
      res = await withRetry(
        async (attempt) => {
          attempts = attempt;
          const send = this.deps.http.send(httpReq);
          const r = this.timeoutMs ? await withTimeout(send, this.timeoutMs) : await send;
          if (!r.ok && isRetryableStatus(r.status)) throw new HttpError(r.status, r.body);
          return r;
        },
        { policy: { maxAttempts: this.maxAttempts, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 }, shouldRetry: (e) => e instanceof HttpError && isRetryableStatus(e.status), sleep: async () => {} },
      );
    } catch (e) {
      breaker.record(false);
      const reason = e instanceof Error ? e.message : String(e);
      this.deps.recovery.deadLetter(req, reason, attempts);
      this.deps.observability.record(req.connectorId, false, this.deps.clock.now() - start);
      return this.finalize(req, connector.evidence, 'dead-lettered', requestHash, start, { attempts, error: reason });
    }
    breaker.record(res.ok);
    this.deps.observability.record(req.connectorId, res.ok, this.deps.clock.now() - start);
    return this.finalize(req, connector.evidence, res.ok ? 'success' : 'failed', requestHash, start, { attempts, status: res.status, body: safeParse(res.body), ...(res.ok ? {} : { error: `HTTP ${res.status}` }) });
  }

  private async buildRequest(connector: ConnectorDescriptor, opSpec: OperationSpec, req: ExecutionRequest): Promise<HttpRequest> {
    const base = req.baseUrl ?? connector.baseUrl;
    let path = opSpec.path;
    // Path templates substitute raw (values are path segments, e.g. "/echo" or "octocat"); query params are encoded below.
    for (const [k, v] of Object.entries(req.params ?? {})) path = path.replace(`{${k}}`, String(v));
    let url = base + path;
    if (req.query) {
      const qs = Object.entries(req.query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }
    const token = req.token ?? (this.options.tokenResolver ? await this.options.tokenResolver(req.tenantId, req.connectorId) : undefined);
    const headers: Record<string, string> = { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(req.headers ?? {}) };
    return { method: opSpec.method, url, headers, ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}) };
  }

  private async finalize(req: ExecutionRequest, evidence: EvidenceLevel, outcome: ExecutionOutcome, requestHash: string, start: number, extra: { status?: number; body?: unknown; attempts?: number; error?: string }): Promise<ExecutionResult> {
    const latencyMs = Math.max(0, this.deps.clock.now() - start);
    const ref = await this.deps.governance.record({ tenantId: req.tenantId, actor: req.actor, connectorId: req.connectorId, operation: req.operation, outcome, ...(extra.status !== undefined ? { status: extra.status } : {}), latencyMs, attempts: extra.attempts ?? 0, evidence, requestHash, ...(extra.error ? { error: extra.error } : {}) });
    const result: ExecutionResult = {
      id: randomId('exec'),
      tenantId: req.tenantId,
      actor: req.actor,
      connectorId: req.connectorId,
      operation: req.operation,
      outcome,
      ...(extra.status !== undefined ? { status: extra.status } : {}),
      ...(extra.body !== undefined ? { body: extra.body } : {}),
      latencyMs,
      attempts: extra.attempts ?? 0,
      auditId: ref.auditId,
      replayId: ref.replayId,
      evidence,
      ...(extra.error ? { error: extra.error } : {}),
      at: ref.at,
    };
    this.executions.push({ result, request: req });
    return result;
  }

  /** Re-execute a recorded execution (replay). */
  async replay(executionId: string): Promise<ExecutionResult> {
    const found = this.executions.find((e) => e.result.id === executionId);
    if (!found) throw new Error(`unknown execution '${executionId}'`);
    return this.execute({ ...found.request });
  }

  history(tenantId?: string): ExecutionResult[] {
    const all = this.executions.map((e) => e.result);
    return tenantId ? all.filter((r) => r.tenantId === tenantId) : all;
  }
  breakerState(connectorId: string): string {
    return this.breakers.get(connectorId).state();
  }
}
