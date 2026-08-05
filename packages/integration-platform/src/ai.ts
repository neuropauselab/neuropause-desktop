/**
 * EPIC 14 — AI Integration Platform. OpenAI, Anthropic, Google Gemini, Azure OpenAI, Ollama, vLLM,
 * and Hugging Face. REUSES the existing AI runtime (Wave 3) — it never re-implements inference.
 * Providers are represented (adapter-verified) until configured; no external model is called here.
 */
import { randomId } from '@neuropause/cloud-core';
import type { IntegrationGovernance } from './governance';
import type { IntegrationContext } from './types';

const AI_PROVIDERS = ['OpenAI', 'Anthropic', 'Google Gemini', 'Azure OpenAI', 'Ollama', 'vLLM', 'Hugging Face'] as const;

export interface AiProviderConnection { id: string; provider: string; configured: boolean; reusedAiRuntime: boolean; note: string }

export class AiIntegration {
  private readonly connections = new Map<string, AiProviderConnection>();

  constructor(
    private readonly governance: IntegrationGovernance,
    private readonly ctx: IntegrationContext,
  ) {}

  providers(): readonly string[] { return AI_PROVIDERS; }

  async connect(input: { provider: string; org?: string }): Promise<AiProviderConnection> {
    if (!(AI_PROVIDERS as readonly string[]).includes(input.provider)) throw new Error(`${input.provider} is not a supported AI provider`);
    const conn: AiProviderConnection = {
      id: randomId('aic'),
      provider: input.provider,
      configured: false,
      reusedAiRuntime: !!this.ctx.aiRuntime,
      note: this.ctx.aiRuntime ? 'represented on top of the reused AI runtime — not called until configured' : 'represented — no AI runtime connected',
    };
    this.connections.set(conn.id, conn);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', integration: '_ai', connector: input.provider, epic: 'E14', operation: 'ai.connect', targetId: conn.id, evidence: 'adapter-verified' });
    return conn;
  }

  /** Number of providers already registered on the reused AI runtime (0 when absent). */
  aiRuntimeProviders(): number {
    return this.ctx.aiRuntime ? this.ctx.aiRuntime.providers().list().length : 0;
  }

  list(): AiProviderConnection[] { return [...this.connections.values()]; }
  count(): number { return this.connections.size; }
}
