/**
 * Inference pipeline (NCEA 10.3, Phase 1). The governed execution path for a
 * single model call: resolve provider (Model Router) → time it → generate →
 * record governance (trace id, event, audit, provider, model, token usage, cost,
 * duration, approval). Callers cannot reach a provider except through here.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ProviderRegistry, AiRequest, AiResult } from './providers';
import { estimateCost, type GovernanceRecorder, type AiExecutionRecord, type ApprovalState } from './governance';

export interface InferenceOptions {
  actor?: string;
  approval?: ApprovalState;
}

export class InferencePipeline {
  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly providers: ProviderRegistry,
    private readonly governance: GovernanceRecorder,
  ) {}

  async generate(
    request: AiRequest,
    options: InferenceOptions = {},
  ): Promise<{ result: AiResult; record: AiExecutionRecord }> {
    const actor = options.actor ?? 'system';
    const approval = options.approval ?? 'not-required';
    const traceId = this.runtime.observability().newTraceId();
    const provider = this.providers.route(request.model, request.provider);
    const timer = this.runtime.observability().startTimer('ai.inference');

    try {
      const result = await provider.generate(request);
      const record = await this.governance.record({
        traceId,
        kind: 'inference',
        target: request.model,
        actor,
        provider: provider.id,
        model: result.model,
        usage: result.usage,
        cost: estimateCost(result.model, result.usage),
        durationMs: timer.end(),
        approval,
        ok: true,
      });
      return { result, record };
    } catch (error) {
      await this.governance.record({
        traceId,
        kind: 'inference',
        target: request.model,
        actor,
        provider: provider.id,
        model: request.model,
        durationMs: timer.end(),
        approval,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
