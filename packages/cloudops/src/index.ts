/**
 * @neuropause/cloudops — NEMS Wave 7 Enterprise Cloud Operations Platform. Composes Waves 1-6
 * (unchanged) into a cloud operations platform: a cloud operations runtime (cloud registry,
 * environment/deployment registries, infrastructure inventory), an environment manager
 * (dev/test/qa/staging/production), a deployment manager, Kubernetes operations (manifest
 * descriptors for 11 resource kinds), a GitOps platform (desired state, drift detection,
 * promotion; ArgoCD/Flux adapters), a configuration platform (over the reused encrypted vault),
 * secret operations (references + rotation metadata; Vault/AWS/Azure/GCP adapters), a release
 * platform (rolling/blue-green/canary/progressive; HITL-gated approval), an infrastructure
 * policy engine, an observability platform (Prometheus/Grafana/Loki/Tempo/OTel adapters),
 * backup & disaster recovery (RPO/RTO), fleet management, cloud operations dashboards, and
 * runtime APIs.
 *
 * Cloud-ops runtime/registries/policy/config/GitOps-drift/fleet/governance are LIVE-VERIFIED
 * in-process over real runtime data; Kubernetes manifests and GitOps/secret/observability/
 * cloud-provider adapters are ADAPTER-VERIFIED (shapes only, never applied); real Kubernetes
 * apply, GitOps reconciliation, live telemetry, live secret synchronization, production
 * failover, disaster-recovery execution, and multi-region deployment are INFRA-PENDING and never
 * executed or fabricated. Every cloud operation is audited on the one chain with a replay id and
 * evidence level.
 */
export * from './constants';
export * from './types';
export * from './evidence';
export * from './governance';
export * from './cloud';
export * from './environments';
export * from './deployments';
export * from './kubernetes';
export * from './gitops';
export * from './config';
export * from './secrets';
export * from './release';
export * from './policy';
export * from './observability';
export * from './backup';
export * from './fleet';
export * from './dashboards';
export * from './platform';
