/**
 * Wave 7 core types. Clouds, environments, deployments, Kubernetes manifests, GitOps
 * state, configuration, secret references, releases, infrastructure policies,
 * observability resources, and recovery plans — all in-process registry records.
 * Every infrastructure record carries an evidence level so the honesty classification
 * is structural: nothing here is a running system.
 */
import type {
  CloudProvider,
  EnvironmentTier,
  WorkloadKind,
  K8sKind,
  GitOpsEngine,
  SecretBackend,
  ReleaseStrategy,
  PolicyKind,
  ObservabilityBackend,
  ObservabilitySignal,
  RecoveryPlanKind,
} from './constants';

export type EvidenceLevel = 'live-verified' | 'adapter-verified' | 'infra-pending';

export type DeploymentStatus = 'planned' | 'described' | 'validated' | 'promoted' | 'retired';
export type DeploymentHealth = 'unknown' | 'healthy' | 'degraded' | 'down';

/** Module 1 — a cloud provider account/target DESCRIPTOR. Never connected. */
export interface CloudDescriptor {
  id: string;
  provider: CloudProvider;
  name: string;
  /** e.g. account id / subscription id / project id — a label, never a live credential. */
  reference: string;
  metadata: Record<string, unknown>;
  /** adapter-verified: the descriptor shape is valid; the account is not connected. */
  evidence: EvidenceLevel;
  note: string;
}

/** Module 2 — an environment tier with policy + secret references. */
export interface Environment {
  id: string;
  name: string;
  tier: EnvironmentTier;
  metadata: Record<string, unknown>;
  targets: string[];
  policyIds: string[];
  secretRefs: string[];
  createdAt: number;
}

/** Module 3 — a deployable workload record. No live deployment. */
export interface Deployment {
  id: string;
  name: string;
  kind: WorkloadKind;
  environmentId: string;
  version: string;
  status: DeploymentStatus;
  health: DeploymentHealth;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** Module 4 — a Kubernetes manifest DESCRIPTOR. Shape validated; never applied. */
export interface K8sManifest {
  id: string;
  kind: K8sKind;
  name: string;
  namespace: string;
  spec: Record<string, unknown>;
  evidence: EvidenceLevel;
  note: string;
}

export interface ManifestValidation {
  kind: K8sKind;
  valid: boolean;
  problems: string[];
}

/** Module 5 — a GitOps repository + desired-state descriptor. */
export interface GitRepository {
  id: string;
  url: string;
  branch: string;
  path: string;
  engine: GitOpsEngine;
  createdAt: number;
  evidence: EvidenceLevel;
  note: string;
}

export interface GitCommit {
  sha: string;
  message: string;
  manifestIds: string[];
  at: number;
}

export interface DriftReport {
  repositoryId: string;
  inSync: boolean;
  added: string[];
  removed: string[];
  changed: string[];
  /** live-verified: the diff is a real in-process computation over desired vs observed state. */
  evidence: EvidenceLevel;
  note: string;
}

/** Module 6 — a configuration entry. Values live in the reused encrypted vault. */
export interface ConfigEntry {
  id: string;
  environmentId: string;
  key: string;
  /** for plain env vars only; secret-backed values are stored encrypted and referenced. */
  value?: string;
  secret: boolean;
  version: number;
  updatedAt: number;
}

/** Module 7 — a secret reference (never the secret value). */
export interface SecretReference {
  id: string;
  backend: SecretBackend;
  path: string;
  environmentId: string;
  rotationDays?: number;
  expiresAt?: number;
  createdAt: number;
  /** adapter-verified: the reference shape is valid; no real backend sync occurs. */
  evidence: EvidenceLevel;
  note: string;
}

/** Module 8 — a release plan. Workflow validated; rollout never executed. */
export interface ReleasePlan {
  id: string;
  deploymentId: string;
  strategy: ReleaseStrategy;
  steps: ReleaseStep[];
  requiresApproval: boolean;
  approved: boolean;
  createdAt: number;
  evidence: EvidenceLevel;
  note: string;
}

export interface ReleaseStep {
  name: string;
  weight: number;
  gate: 'auto' | 'manual';
}

/** Module 9 — an infrastructure policy + its evaluation result. */
export interface InfraPolicy {
  id: string;
  kind: PolicyKind;
  name: string;
  rule: Record<string, unknown>;
  createdAt: number;
}

export interface PolicyEvaluation {
  policyId: string;
  kind: PolicyKind;
  targetId: string;
  passed: boolean;
  violations: string[];
  /** live-verified: evaluated in-process against the descriptor. */
  evidence: EvidenceLevel;
}

/** Module 10 — an observability resource DESCRIPTOR. No live telemetry. */
export interface ObservabilityResource {
  id: string;
  backend: ObservabilityBackend;
  signal: ObservabilitySignal;
  name: string;
  spec: Record<string, unknown>;
  evidence: EvidenceLevel;
  note: string;
}

/** Module 11 — a backup / disaster-recovery plan. Simulation only. */
export interface RecoveryPlan {
  id: string;
  kind: RecoveryPlanKind;
  name: string;
  targetId: string;
  /** recovery point objective (minutes) — a stated target, not a measured guarantee. */
  rpoMinutes?: number;
  /** recovery time objective (minutes) — a stated target, not a measured guarantee. */
  rtoMinutes?: number;
  metadata: Record<string, unknown>;
  createdAt: number;
  evidence: EvidenceLevel;
  note: string;
}

/** Module 12 — one unified fleet inventory snapshot. */
export interface FleetInventory {
  organizations: number;
  regions: number;
  clusters: number;
  clouds: number;
  environments: number;
  deployments: number;
  applications: number;
  note: string;
}
