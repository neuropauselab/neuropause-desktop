/**
 * Integration platform composition root (NCEA 13.0). `createIntegrationPlatform`
 * wires the production adapters onto the EXISTING platform: AI provider adapters
 * register into the ai-runtime ProviderRegistry (so they stay governed by the
 * Enterprise Runtime), credentials live in the connector platform's Secret Vault,
 * sync state persists through the Enterprise Persistence Platform, and webhook
 * events flow onto the one Runtime event bus. No new runtime, vault, bus, or
 * persistence — only real adapters behind the interfaces already there.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ProviderRegistry } from '@neuropause/ai-runtime';
import { InMemorySecretVault, type SecretVault } from '@neuropause/connectors';
import type { PersistenceLayer } from '@neuropause/persistence';
import { INTEGRATIONS_VERSION } from './constants';
import { FetchHttpClient, type HttpClient } from './http';
import { createProvider, type HttpAiProvider, type ProviderConfig } from './providers';
import { CredentialManager } from './vaultCredentials';
import { WebhookReceiver } from './webhooks';
import { SyncEngine } from './sync';
import { IntegrationObservability, type PriceTable } from './observability';
import { INTEGRATION_MATRIX, readinessSummary, type IntegrationEntry, type ReadinessSummary } from './matrix';

export interface IntegrationPlatformOptions {
  runtime: EnterpriseRuntime;
  http?: HttpClient;
  vault?: SecretVault;
  persistence?: PersistenceLayer;
  clock?: Clock;
  prices?: PriceTable;
}

export interface IntegrationPlatform {
  version: string;
  http(): HttpClient;
  provider(id: string, config?: ProviderConfig): HttpAiProvider;
  /** Build + register provider adapters into the ai-runtime registry (governed). */
  registerProviders(registry: ProviderRegistry, configs: Record<string, ProviderConfig>): HttpAiProvider[];
  credentials(): CredentialManager;
  webhooks(): WebhookReceiver;
  sync(): SyncEngine;
  observability(): IntegrationObservability;
  matrix(): IntegrationEntry[];
  readiness(): ReadinessSummary;
}

export function createIntegrationPlatform(options: IntegrationPlatformOptions): IntegrationPlatform {
  const clock = options.clock ?? systemClock;
  const http = options.http ?? new FetchHttpClient();
  const vault = options.vault ?? new InMemorySecretVault(clock);
  const credentials = new CredentialManager(vault, clock);
  const webhooks = new WebhookReceiver(options.runtime, clock);
  const observability = new IntegrationObservability(options.runtime, options.prices);
  let syncEngine: SyncEngine | undefined;

  return {
    version: INTEGRATIONS_VERSION,
    http: () => http,
    provider: (id, config) => createProvider(id, http, config, { clock }),
    registerProviders: (registry, configs) => {
      const built: HttpAiProvider[] = [];
      for (const [id, config] of Object.entries(configs)) {
        const provider = createProvider(id, http, config, { clock });
        registry.register(provider);
        built.push(provider);
      }
      return built;
    },
    credentials: () => credentials,
    webhooks: () => webhooks,
    sync: () => {
      if (!options.persistence) throw new Error('sync requires a persistence layer (pass options.persistence)');
      syncEngine ??= new SyncEngine(options.persistence, clock);
      return syncEngine;
    },
    observability: () => observability,
    matrix: () => INTEGRATION_MATRIX,
    readiness: () => readinessSummary(),
  };
}
