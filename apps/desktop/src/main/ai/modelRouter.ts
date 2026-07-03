/**
 * Model Router. Maps a provider-agnostic tier ('fast' | 'balanced' | 'deep') to
 * a concrete model and the client that serves it. Today every tier resolves to
 * Claude; adding GPT/Gemini/local later means registering another ModelClient
 * and extending the tier map — callers never change and never learn which model
 * ran.
 */
import type { AiModelTier } from '@neuropause/shared';
import type { ModelClient } from './modelClient';

export interface RouterConfig {
  /** The client to use (Claude today). */
  client: ModelClient;
  /** Tier → concrete model id. */
  models?: Partial<Record<AiModelTier, string>>;
  defaultTier?: AiModelTier;
}

const DEFAULT_MODELS: Record<AiModelTier, string> = {
  fast: 'claude-haiku-4-5-20251001',
  balanced: 'claude-sonnet-4-6',
  deep: 'claude-opus-4-8',
};

export class ModelRouter {
  private readonly client: ModelClient;
  private readonly models: Record<AiModelTier, string>;
  private readonly defaultTier: AiModelTier;

  constructor(cfg: RouterConfig) {
    this.client = cfg.client;
    this.models = { ...DEFAULT_MODELS, ...(cfg.models ?? {}) };
    this.defaultTier = cfg.defaultTier ?? 'balanced';
  }

  /** Resolve a tier to the concrete model + client that will serve it. */
  resolve(tier?: AiModelTier): { model: string; client: ModelClient } {
    const t = tier ?? this.defaultTier;
    return { model: this.models[t], client: this.client };
  }

  isConfigured(): boolean {
    return this.client.isConfigured();
  }
}
