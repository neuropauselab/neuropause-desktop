/**
 * Module 1 + 14 — Cloud Operations Runtime & Runtime APIs / composition root.
 * `createCloudOpsPlatform(runtime, …)` assembles the Wave 7 cloud-operations layer on the
 * EXISTING platform: it reuses the one runtime audit chain + event bus (cloud-ops governance),
 * the security KeyManager + Wave 2 EncryptedSecretVault (configuration secrets), the Wave 4
 * HITL gate (release approval), and — when provided — the Wave 6 federation platform (fleet
 * orgs/regions/clusters) and the Wave 5 execution platform (reused connector count). No service
 * is duplicated. Exposes the runtime.* API surface plus accessors, the evidence matrix, and readiness.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { KeyManager } from '@neuropause/security';
import { EncryptedSecretVault } from '@neuropause/connectivity';
import { HumanInTheLoopGate } from '@neuropause/automation';
import type { ExecutionPlatform } from '@neuropause/execution';
import type { FederationPlatform } from '@neuropause/federation';
import { CLOUDOPS_VERSION } from './constants';
import { CLOUDOPS_MATRIX, cloudOpsReadiness, type CapabilityEvidence, type CloudOpsReadiness } from './evidence';
import { CloudOpsGovernance } from './governance';
import { CloudRegistry } from './cloud';
import { EnvironmentManager } from './environments';
import { DeploymentManager } from './deployments';
import { KubernetesOperations } from './kubernetes';
import { GitOpsPlatform } from './gitops';
import { ConfigurationPlatform } from './config';
import { SecretOperations } from './secrets';
import { ReleasePlatform } from './release';
import { InfrastructurePolicyEngine } from './policy';
import { ObservabilityPlatform } from './observability';
import { BackupDisasterRecovery } from './backup';
import { FleetManagement } from './fleet';
import { CloudOpsDashboards } from './dashboards';

export interface CloudOpsPlatformOptions {
  clock?: Clock;
  keyManager?: KeyManager;
  federation?: FederationPlatform;
  execution?: ExecutionPlatform;
}

export interface CloudOpsPlatform {
  version: string;
  // runtime.* API surface (Module 14)
  cloud(): CloudRegistry;
  environments(): EnvironmentManager;
  deployments(): DeploymentManager;
  gitops(): GitOpsPlatform;
  config(): ConfigurationPlatform;
  secrets(): SecretOperations;
  release(): ReleasePlatform;
  infrastructure(): KubernetesOperations;
  fleet(): FleetManagement;
  observability(): ObservabilityPlatform;
  backups(): BackupDisasterRecovery;
  // additional accessors
  kubernetes(): KubernetesOperations;
  policy(): InfrastructurePolicyEngine;
  dashboards(): CloudOpsDashboards;
  governance(): CloudOpsGovernance;
  /** Reused Wave 5 execution connector count (0 when no execution platform is supplied). */
  reusedConnectorCount(): number;
  matrix(): CapabilityEvidence[];
  readiness(): CloudOpsReadiness;
}

export function createCloudOpsPlatform(runtime: EnterpriseRuntime, options: CloudOpsPlatformOptions = {}): CloudOpsPlatform {
  const clock = options.clock ?? systemClock;
  const keyManager = options.keyManager ?? new KeyManager();
  const vault = new EncryptedSecretVault(keyManager, clock);
  const hitl = new HumanInTheLoopGate();

  const governance = new CloudOpsGovernance(runtime, clock);
  const clouds = new CloudRegistry(governance);
  const environments = new EnvironmentManager(clock, governance);
  const deployments = new DeploymentManager(clock, governance);
  const kubernetes = new KubernetesOperations(governance);
  const gitops = new GitOpsPlatform(clock, governance);
  const config = new ConfigurationPlatform(clock, governance, vault);
  const secrets = new SecretOperations(clock, governance);
  const release = new ReleasePlatform(clock, governance, hitl);
  const policy = new InfrastructurePolicyEngine(clock, governance);
  const observability = new ObservabilityPlatform(governance);
  const backups = new BackupDisasterRecovery(clock, governance);
  const fleet = new FleetManagement({ clouds, environments, deployments, ...(options.federation ? { federation: options.federation } : {}) });
  const dashboards = new CloudOpsDashboards({ deployments, environments, policy, config, fleet, observability });

  return {
    version: CLOUDOPS_VERSION,
    cloud: () => clouds,
    environments: () => environments,
    deployments: () => deployments,
    gitops: () => gitops,
    config: () => config,
    secrets: () => secrets,
    release: () => release,
    infrastructure: () => kubernetes,
    fleet: () => fleet,
    observability: () => observability,
    backups: () => backups,
    kubernetes: () => kubernetes,
    policy: () => policy,
    dashboards: () => dashboards,
    governance: () => governance,
    reusedConnectorCount: () => options.execution?.connectors().count() ?? 0,
    matrix: () => CLOUDOPS_MATRIX,
    readiness: () => cloudOpsReadiness(),
  };
}
