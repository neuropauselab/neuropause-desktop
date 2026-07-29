/**
 * Connector Platform composition root (NCEA 10.4, Phase 10). `createConnectorPlatform
 * (enterpriseRuntime)` assembles the registry, executor, secret vault, auth
 * framework, trigger + automation engines, observability, governance, and
 * marketplace — all sharing the runtime's SINGLE bus, audit chain, timeline,
 * scheduler, and metrics. Exposes the connector enterprise APIs. No duplicate
 * infrastructure; every connector execution is auditable + observable.
 */
import { systemClock, type Clock, type CloudEvent } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { CONNECTORS_VERSION } from './constants';
import { ConnectorRegistry, type ConnectorEntry } from './registry';
import { ConnectorGovernance } from './governance';
import { ConnectorExecutor } from './execution';
import { InMemorySecretVault, type SecretVault } from './vault';
import { AuthFramework } from './auth';
import { TriggerEngine } from './triggers';
import { AutomationEngine } from './automation';
import { ConnectorObservability } from './observability';
import { MarketplaceFoundation } from './marketplace';
import type { ConnectorHealth, ConnectorPolicy } from './sdk';

export interface ConnectorPlatformOptions {
  clock?: Clock;
  vault?: SecretVault;
  signingKey?: string;
}

export interface ConnectorPlatform {
  version: string;
  connectors(): ConnectorExecutor;
  connector(id: string): ConnectorEntry | undefined;
  connectorRegistry(): ConnectorRegistry;
  connectorHealth(): Array<{ id: string; health: ConnectorHealth }>;
  connectorMetrics(): ConnectorObservability;
  connectorSecrets(): SecretVault;
  connectorAuth(): AuthFramework;
  connectorPolicies(id: string): ConnectorPolicy[];
  connectorScheduler(): TriggerEngine;
  connectorAutomation(): AutomationEngine;
  connectorAudit(): ConnectorGovernance;
  marketplace(): MarketplaceFoundation;
}

export function createConnectorPlatform(
  runtime: EnterpriseRuntime,
  options: ConnectorPlatformOptions = {},
): ConnectorPlatform {
  const clock = options.clock ?? systemClock;
  const vault = options.vault ?? new InMemorySecretVault(clock);
  const registry = new ConnectorRegistry(clock);
  const governance = new ConnectorGovernance(runtime, clock);
  const executor = new ConnectorExecutor(runtime, registry, governance, vault, clock);
  const auth = new AuthFramework(vault, clock);
  const triggers = new TriggerEngine(runtime);
  const automation = new AutomationEngine(runtime, governance);
  const observability = new ConnectorObservability(runtime);
  const marketplace = new MarketplaceFoundation(registry, options.signingKey ?? 'dev-signing-key', runtime.version);

  // Observability derived from the execution event stream (audit-correlated).
  runtime.events().subscribe('connector.execution', (event: CloudEvent) => {
    const p = event.payload as { connectorId: string; ok: boolean; retryCount: number; durationMs: number };
    observability.observe(p.connectorId, { ok: p.ok, retries: p.retryCount, latencyMs: p.durationMs });
    observability.setQueueDepth(automation.queueDepth());
  });

  // Triggers run automations (through the shared scheduler/bus).
  triggers.onFire(async (trigger) => {
    if (automation.get(trigger.automation)) await automation.run(trigger.automation);
  });

  return {
    version: CONNECTORS_VERSION,
    connectors: () => executor,
    connector: (id) => registry.get(id),
    connectorRegistry: () => registry,
    connectorHealth: () => registry.health(),
    connectorMetrics: () => observability,
    connectorSecrets: () => vault,
    connectorAuth: () => auth,
    connectorPolicies: (id) => registry.get(id)?.def.policies ?? [],
    connectorScheduler: () => triggers,
    connectorAutomation: () => automation,
    connectorAudit: () => governance,
    marketplace: () => marketplace,
  };
}
