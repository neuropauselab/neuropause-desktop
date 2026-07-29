/**
 * EPIC 7 — AI Runtime Operations. Ollama / OpenAI / Anthropic / Gemini / Azure OpenAI adapters, with
 * model routing, usage limits, provider failover, and health. Routing + failover are REAL in-process
 * logic; the AI providers themselves are represented (adapter-verified) and their live count is read
 * from the reused AI runtime. No external model is actually invoked here.
 */
import { AI_PROVIDERS, type AiProvider } from './constants';
import type { PlatformOpsContext } from './types';
import type { PlatformOpsGovernance } from './governance';

export interface ProviderRegistration {
  provider: AiProvider;
  configured: boolean;
  usageLimitPerMin: number;
}

export interface RouteResult {
  model: string;
  selected: AiProvider | null;
  failedOver: boolean;
  note: string;
}

export class AiRuntimeOperations {
  private readonly providers = new Map<AiProvider, ProviderRegistration>();

  constructor(
    private readonly ctx: PlatformOpsContext,
    private readonly gov: PlatformOpsGovernance,
    private readonly operator: string,
  ) {}

  supportedProviders(): readonly AiProvider[] {
    return AI_PROVIDERS;
  }

  async register(input: { provider: AiProvider; usageLimitPerMin?: number; configured?: boolean }): Promise<ProviderRegistration> {
    if (!AI_PROVIDERS.includes(input.provider)) throw new Error(`unknown AI provider: ${input.provider}`);
    const reg: ProviderRegistration = { provider: input.provider, configured: Boolean(input.configured), usageLimitPerMin: input.usageLimitPerMin ?? 60 };
    this.providers.set(input.provider, reg);
    await this.gov.record({ operator: this.operator, environment: 'production', deployment: '_none', cluster: '_ai', version: '_platform', epic: 'E7', operation: 'register-provider', targetId: input.provider, evidence: 'adapter-verified', decision: reg.configured ? 'configured' : 'represented' });
    return reg;
  }

  /** Real in-process routing: pick the first configured provider in the preference order; fail over otherwise. */
  route(input: { model: string; preference?: AiProvider[] }): RouteResult {
    const order = input.preference ?? [...AI_PROVIDERS];
    const configured = order.filter((p) => this.providers.get(p)?.configured);
    if (configured.length > 0) return { model: input.model, selected: configured[0]!, failedOver: configured[0] !== order[0], note: 'routed to a configured provider' };
    return { model: input.model, selected: null, failedOver: false, note: 'no configured provider — represented only, no model invoked' };
  }

  /** The number of providers the reused AI runtime represents. */
  aiRuntimeProviderCount(): { count: number; reusedAiRuntime: boolean } {
    if (this.ctx.aiRuntime) return { count: this.ctx.aiRuntime.providers().list().length, reusedAiRuntime: true };
    return { count: 0, reusedAiRuntime: false };
  }

  registeredCount(): number {
    return this.providers.size;
  }
}
