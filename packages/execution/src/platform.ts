/**
 * Composition root — `createExecutionPlatform(runtime, …)` assembles the Wave 5 execution
 * platform on the EXISTING platform: it reuses the one audit chain + event bus (governance,
 * webhooks, streaming), the security KeyManager + Wave 2 encrypted vault (rotation), the
 * integrations transport/OAuth/reliability/webhooks, and the Wave 4 HITL gate. The transport
 * is injectable: a FetchHttpClient (default) executes over real HTTP; a FakeHttpClient drives
 * adapter-verified tests. Exposes the full runtime API surface.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { KeyManager } from '@neuropause/security';
import { FetchHttpClient, CredentialManager, type HttpClient } from '@neuropause/integrations';
import { EncryptedSecretVault } from '@neuropause/connectivity';
import { HumanInTheLoopGate } from '@neuropause/automation';
import { EXECUTION_VERSION } from './constants';
import { EXECUTION_MATRIX, executionReadiness, type CapabilityEvidence, type ExecutionReadiness } from './evidence';
import { UniversalConnectorRuntime } from './runtime';
import { ExternalExecutionGovernance } from './governance';
import { PolicyEngine } from './policy';
import { ConnectorObservability } from './observability';
import { ConnectorRateLimiter, RetryRecoveryEngine } from './reliability';
import { SecretRotationPlatform } from './vault';
import { OAuthLifecycleManager } from './oauth';
import { ConnectorExecutionEngine, type EngineOptions } from './engine';
import { UniversalApiGateway } from './gateway';
import { ConnectorHealthMonitor } from './health';
import { WebhookRuntime } from './webhooks';
import { EventStreamingPlatform } from './streaming';
import { ConnectorAnalytics } from './analytics';
import { ProductionDashboards } from './dashboards';

export interface ExecutionPlatformOptions {
  clock?: Clock;
  http?: HttpClient;
  keyManager?: KeyManager;
  engine?: EngineOptions;
}

export interface ExecutionPlatform {
  version: string;
  connectors(): UniversalConnectorRuntime;
  engine(): ConnectorExecutionEngine;
  gateway(): UniversalApiGateway;
  oauth(): OAuthLifecycleManager;
  rotation(): SecretRotationPlatform;
  vault(): EncryptedSecretVault;
  credentials(): CredentialManager;
  health(): ConnectorHealthMonitor;
  rateLimiter(): ConnectorRateLimiter;
  recovery(): RetryRecoveryEngine;
  webhooks(): WebhookRuntime;
  streaming(): EventStreamingPlatform;
  observability(): ConnectorObservability;
  policy(): PolicyEngine;
  governance(): ExternalExecutionGovernance;
  analytics(): ConnectorAnalytics;
  dashboards(): ProductionDashboards;
  matrix(): CapabilityEvidence[];
  readiness(): ExecutionReadiness;
}

export function createExecutionPlatform(runtime: EnterpriseRuntime, options: ExecutionPlatformOptions = {}): ExecutionPlatform {
  const clock = options.clock ?? systemClock;
  const http = options.http ?? new FetchHttpClient();
  const keyManager = options.keyManager ?? new KeyManager();

  const vault = new EncryptedSecretVault(keyManager, clock);
  const credentials = new CredentialManager(vault, clock);
  const governance = new ExternalExecutionGovernance(runtime, clock);
  const policy = new PolicyEngine();
  const observability = new ConnectorObservability();
  const rateLimiter = new ConnectorRateLimiter(clock);
  const recovery = new RetryRecoveryEngine(clock);
  const hitl = new HumanInTheLoopGate();

  const connectors = new UniversalConnectorRuntime();
  const engine = new ConnectorExecutionEngine({ http, connectors, policy, hitl, rateLimiter, recovery, observability, governance, clock }, options.engine ?? {});
  const gateway = new UniversalApiGateway(engine);
  const oauth = new OAuthLifecycleManager(credentials, http);
  const rotation = new SecretRotationPlatform(vault, clock);
  const health = new ConnectorHealthMonitor(engine, connectors, clock);
  const webhooks = new WebhookRuntime(runtime, clock);
  const streaming = new EventStreamingPlatform(runtime);
  const analytics = new ConnectorAnalytics(engine, recovery);
  const dashboards = new ProductionDashboards(analytics, health, recovery);

  return {
    version: EXECUTION_VERSION,
    connectors: () => connectors,
    engine: () => engine,
    gateway: () => gateway,
    oauth: () => oauth,
    rotation: () => rotation,
    vault: () => vault,
    credentials: () => credentials,
    health: () => health,
    rateLimiter: () => rateLimiter,
    recovery: () => recovery,
    webhooks: () => webhooks,
    streaming: () => streaming,
    observability: () => observability,
    policy: () => policy,
    governance: () => governance,
    analytics: () => analytics,
    dashboards: () => dashboards,
    matrix: () => EXECUTION_MATRIX,
    readiness: () => executionReadiness(),
  };
}
