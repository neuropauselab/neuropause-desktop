/**
 * Operational Readiness Matrix (NCEA 15.0, deliverable 18). The honest ledger of
 * what is proven here with deterministic logic, real crypto/backup drills, and real
 * resource sampling (VERIFIED) versus what needs real distributed infrastructure,
 * load generators at scale, cloud DR, or a live orchestrator (INFRA-PENDING). A
 * test enforces the invariants: nothing needing a real cluster, production-scale
 * load, cross-region DR, or a live deployment target is ever marked verified.
 */
export type Evidence = 'verified' | 'infra-pending';

export interface CapabilityEntry {
  id: string;
  area: string;
  capability: string;
  evidence: Evidence;
  note?: string;
}

export const OPERATIONS_MATRIX: CapabilityEntry[] = [
  // ── VERIFIED (deterministic logic / real crypto / real resource sampling) ──
  { id: 'health.registry', area: 'health', capability: 'Global health registry: aggregation, history, startup/shutdown verification, degradation states', evidence: 'verified' },
  { id: 'reliability.policies', area: 'reliability', capability: 'Centralized circuit breaker / retry / timeout / bulkhead / fallback policies', evidence: 'verified', note: 'breaker/retry/timeout reused from integrations, not reimplemented' },
  { id: 'reliability.classification', area: 'reliability', capability: 'Transient vs permanent failure classification + auto-recovery hooks', evidence: 'verified' },
  { id: 'jobs.lifecycle', area: 'jobs', capability: 'Persistent-job lifecycle: priority, delayed execution, cancellation, replay', evidence: 'verified' },
  { id: 'jobs.dlq', area: 'jobs', capability: 'Retry queue, dead-letter queue, poison-message handling, backpressure', evidence: 'verified' },
  { id: 'jobs.recovery', area: 'jobs', capability: 'Checkpoint recovery + interrupted-job recovery on the existing scheduler', evidence: 'verified' },
  { id: 'coord.discovery', area: 'coordination', capability: 'Service discovery + deterministic dependency ordering (cycle-detecting)', evidence: 'verified' },
  { id: 'coord.primitives', area: 'coordination', capability: 'Leader-election, distributed-lock, heartbeat interfaces (single-node)', evidence: 'verified', note: 'contracts a real backend implements' },
  { id: 'dr.drill', area: 'disaster-recovery', capability: 'Backup → loss → restore → validate drill with RPO/RTO measurement', evidence: 'verified' },
  { id: 'dr.realpg', area: 'disaster-recovery', capability: 'DR drill executed against real embedded Postgres (persistence BackupManager)', evidence: 'verified' },
  { id: 'trace.spans', area: 'observability', capability: 'Distributed tracing spans + correlation ids + service dependency graph', evidence: 'verified' },
  { id: 'obs.dashboard', area: 'observability', capability: 'Unified operations dashboard over the one metrics registry', evidence: 'verified' },
  { id: 'perf.harness', area: 'performance', capability: 'In-process load / stress / soak harness + latency percentiles', evidence: 'verified' },
  { id: 'perf.resources', area: 'performance', capability: 'Real memory + CPU sampling and per-operation profiling', evidence: 'verified' },
  { id: 'perf.regression', area: 'performance', capability: 'Performance baselines + regression detection + capacity forecasting', evidence: 'verified' },
  { id: 'deploy.strategies', area: 'deployment', capability: 'Blue/green, canary, rolling, recreate state machines + safe rollback', evidence: 'verified' },
  { id: 'deploy.controls', area: 'deployment', capability: 'Feature flags, version compatibility, paired migration coordination', evidence: 'verified' },
  { id: 'opsec.controls', area: 'operational-security', capability: 'Runtime integrity, config validation, secret/cert monitoring, threat aggregation', evidence: 'verified' },
  { id: 'incidents.audit', area: 'incident-management', capability: 'Incident registry wired to the one audit chain + MTTR + postmortems', evidence: 'verified' },
  { id: 'deploy.audit', area: 'deployment', capability: 'Deployment + migration events on the one audit chain', evidence: 'verified' },

  // ── INFRA-PENDING (need real distributed / cloud / production infrastructure) ──
  { id: 'coord.cluster', area: 'coordination', capability: 'Real multi-node leader election + distributed locks + cluster membership', evidence: 'infra-pending', note: 'needs etcd / Consul / ZooKeeper / Kubernetes' },
  { id: 'dr.cluster', area: 'disaster-recovery', capability: 'Cluster PITR (WAL/base backups) + cross-region failover drills', evidence: 'infra-pending', note: 'Postgres/cloud operational procedures' },
  { id: 'perf.scale', area: 'performance', capability: 'Production-scale load / stress / soak (real load generators, multi-node)', evidence: 'infra-pending', note: 'needs load-generation infra + production hardware' },
  { id: 'deploy.live', area: 'deployment', capability: 'Live blue/green + canary against real orchestrators / load balancers', evidence: 'infra-pending', note: 'needs a real deployment environment' },
  { id: 'obs.export', area: 'observability', capability: 'Wire telemetry export (OTLP / Jaeger / Prometheus / Grafana)', evidence: 'infra-pending', note: 'needs a collector endpoint' },
  { id: 'opsec.stores', area: 'operational-security', capability: 'Live secret store (Vault) + certificate manager (ACM) integration', evidence: 'infra-pending', note: 'monitoring logic is verified; live wiring is pending' },
];

export function readinessSummary(matrix: CapabilityEntry[] = OPERATIONS_MATRIX): { total: number; verified: number; infraPending: number } {
  return {
    total: matrix.length,
    verified: matrix.filter((e) => e.evidence === 'verified').length,
    infraPending: matrix.filter((e) => e.evidence === 'infra-pending').length,
  };
}

/** The capabilities that require real infrastructure — the invariant guards these stay INFRA-PENDING. */
export const INFRA_PENDING_IDS = new Set(OPERATIONS_MATRIX.filter((e) => e.evidence === 'infra-pending').map((e) => e.id));
