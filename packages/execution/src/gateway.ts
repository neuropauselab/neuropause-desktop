/**
 * Module 11 — Universal API Gateway. One request/response contract in front of the
 * execution engine, with single and batch calls. It normalizes every connector into the
 * same shape and returns the governed result (outcome, evidence, audit/replay ids). The
 * gateway does not bypass the engine — every call goes through the full pipeline.
 */
import type { ConnectorExecutionEngine } from './engine';
import type { ExecutionRequest, ExecutionResult } from './types';
import type { EvidenceLevel } from './types';
import type { ExecutionOutcome } from './constants';

export interface GatewayResponse {
  ok: boolean;
  outcome: ExecutionOutcome;
  status?: number;
  data?: unknown;
  latencyMs: number;
  attempts: number;
  auditId: string;
  replayId: string;
  evidence: EvidenceLevel;
  error?: string;
}

export class UniversalApiGateway {
  constructor(private readonly engine: ConnectorExecutionEngine) {}

  private map(r: ExecutionResult): GatewayResponse {
    return {
      ok: r.outcome === 'success',
      outcome: r.outcome,
      ...(r.status !== undefined ? { status: r.status } : {}),
      ...(r.body !== undefined ? { data: r.body } : {}),
      latencyMs: r.latencyMs,
      attempts: r.attempts,
      auditId: r.auditId,
      replayId: r.replayId,
      evidence: r.evidence,
      ...(r.error ? { error: r.error } : {}),
    };
  }

  async call(req: ExecutionRequest): Promise<GatewayResponse> {
    return this.map(await this.engine.execute(req));
  }

  /** Batch execution — each request runs through the full pipeline. */
  async batch(reqs: ExecutionRequest[]): Promise<GatewayResponse[]> {
    const out: GatewayResponse[] = [];
    for (const r of reqs) out.push(await this.call(r));
    return out;
  }
}
