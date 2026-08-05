/**
 * Sprint 4 capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave 14 model).
 * Evidence is NEVER promoted without a real, executed basis:
 *   live-verified          — the in-process runtimes that really execute here: the validation and
 *                            reliability runtimes, the (reused) performance/load harness, chaos in a
 *                            sandbox, recovery validation (reused production backups/DR), the real
 *                            static/secret/config security scans, reliability math, SLOs, operational
 *                            readiness, the RC gate, diagnostics, observability validation, readiness
 *                            scoring, the SDK, governance, and documentation.
 *   adapter-verified       — EXTERNAL tools that do the real production-grade work: SAST/dependency/
 *                            DAST scanners, compliance platforms, cloud monitoring, and load
 *                            generators; represented until the customer configures them.
 *   business-data-pending  — real production customer workloads, real incident history, operational
 *                            trends, customer performance baselines, and real compliance audit
 *                            evidence; never fabricated.
 *   infrastructure-pending — the customer's own production infrastructure: production clusters,
 *                            production-scale traffic, multi-region failover, external DR sites, and
 *                            production penetration-test targets; represented until provided.
 * A test asserts that no adapter, business-data, or infrastructure capability is ever classified live.
 */
import type { ReliabilityEvidenceLevel } from './types';
import { MATRIX_ADAPTERS, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: ReliabilityEvidenceLevel;
  note: string;
}

export const RELIABILITY_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — in-process runtimes that really execute ──
  { capability: 'Production Validation Runtime', epic: 'E1', level: 'live-verified', note: 'Registers + runs validation suites; a suite is passed/failed only after a real execution.' },
  { capability: 'End-to-End Validation', epic: 'E2', level: 'live-verified', note: 'Real cross-subsystem traces over reused identity/authn/authz, AI, integration, operations.' },
  { capability: 'Performance Engineering', epic: 'E3', level: 'live-verified', note: 'REUSES the operations PerformanceMonitor: real timing + real memory/CPU sampling. No fabricated numbers.' },
  { capability: 'Load / Stress / Endurance Testing', epic: 'E4', level: 'live-verified', note: 'Measured load/stress/soak via the reused harness; recovery is measured, not assumed.' },
  { capability: 'Chaos Engineering', epic: 'E5', level: 'live-verified', note: 'Controlled fault injection into an in-process sandbox only; never affects production.' },
  { capability: 'Recovery Validation', epic: 'E6', level: 'live-verified', note: 'REUSES production backups/DR; records measured recovery evidence on the one chain.' },
  { capability: 'Security Hardening', epic: 'E7', level: 'live-verified', note: 'Real static/secret/configuration scans over the source tree; external scanners represented.' },
  { capability: 'Reliability Engineering', epic: 'E10', level: 'live-verified', note: 'Real availability/MTTR/MTBF/score math computed from recorded incidents.' },
  { capability: 'SLO / SLA Platform', epic: 'E11', level: 'live-verified', note: 'Real error-budget math; status derived from the numbers, never asserted.' },
  { capability: 'Operational Readiness', epic: 'E12', level: 'live-verified', note: 'Runbook/playbook/DR/on-call/escalation/maintenance registry; completeness computed from entries.' },
  { capability: 'Release Candidate Platform', epic: 'E13', level: 'live-verified', note: 'Aggregates real gates into an RC decision; GA is hard-coded false and never declared.' },
  { capability: 'Production Diagnostics', epic: 'E14', level: 'live-verified', note: 'REUSES the production diagnostics bundler; local snapshot otherwise. No fabricated state.' },
  { capability: 'Observability Validation', epic: 'E15', level: 'live-verified', note: 'Real metrics round-trip + audit-chain verification; external monitors represented.' },
  { capability: 'Production Readiness Scoring', epic: 'E16', level: 'live-verified', note: 'Deterministic weighted score over real sub-signals; top band is release-candidate, not GA.' },
  { capability: 'Reliability SDK', epic: 'E17', level: 'live-verified', note: 'Typed descriptors + in-process code samples; no I/O.' },
  { capability: 'Reliability Governance', epic: 'E18', level: 'live-verified', note: 'Every operation audited on the one hash-chained ledger with a replay id.' },
  { capability: 'Reliability Documentation', epic: 'E19', level: 'live-verified', note: 'Nine guide outlines; REUSES the production documentation generator for overlapping kinds.' },
  // ── Adapter-verified — external tools, until configured ──
  { capability: 'External SAST scanners', epic: 'E7', level: 'adapter-verified', note: 'Snyk/CodeQL/Semgrep represented; adapter-verified until configured against the customer account.' },
  { capability: 'External dependency scanners', epic: 'E7', level: 'adapter-verified', note: 'Dependency/supply-chain scanning is performed by external tools; represented until configured.' },
  { capability: 'External DAST / pentest tools', epic: 'E8', level: 'adapter-verified', note: 'OWASP ZAP/Burp represented; no attack is run from here, no certification claimed.' },
  { capability: 'External compliance platforms', epic: 'E9', level: 'adapter-verified', note: 'Vanta/Drata/OneTrust represented; evidence packages generated, compliance never claimed.' },
  { capability: 'Cloud monitoring services', epic: 'E15', level: 'adapter-verified', note: 'Datadog/New Relic/Prometheus/Grafana represented; production-scale collection until configured.' },
  { capability: 'External load generators', epic: 'E4', level: 'adapter-verified', note: 'k6/Locust/Gatling represented; the in-process harness measures locally until configured.' },
  // ── Business-data-pending — real production data; never fabricated ──
  { capability: 'Production customer workloads', epic: 'E2', level: 'business-data-pending', note: 'No real customer production workload is validated here; synthetic probes only.' },
  { capability: 'Real incident history', epic: 'E10', level: 'business-data-pending', note: 'Reliability math runs on recorded incidents; real production incident history is not imported.' },
  { capability: 'Operational trends', epic: 'E10', level: 'business-data-pending', note: 'Long-run operational trends require real production data; none is fabricated.' },
  { capability: 'Customer performance baselines', epic: 'E3', level: 'business-data-pending', note: 'Baselines are captured from measured local runs; real customer baselines are pending.' },
  { capability: 'Real compliance audit evidence', epic: 'E9', level: 'business-data-pending', note: 'Control mechanisms are mapped; a real external audit produces the certifying evidence.' },
  // ── Infrastructure-pending — the customer's own production infrastructure ──
  { capability: 'Customer production clusters', epic: 'E13', level: 'infrastructure-pending', note: 'RC gating represents readiness; deploying to real customer clusters is pending.' },
  { capability: 'Production-scale traffic', epic: 'E4', level: 'infrastructure-pending', note: 'Real network load generators on production hardware are pending; the harness is in-process.' },
  { capability: 'Multi-region failover', epic: 'E6', level: 'infrastructure-pending', note: 'DR plan structure is validated; real cross-region failover requires configured infrastructure.' },
  { capability: 'External DR sites', epic: 'E6', level: 'infrastructure-pending', note: 'External disaster-recovery sites are represented; none is provisioned here.' },
  { capability: 'Production penetration-test targets', epic: 'E8', level: 'infrastructure-pending', note: 'Authorized production pentest targets are the customer’s; no third-party system is tested here.' },
];

export interface ReliabilityReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function reliabilityReadiness(matrix: CapabilityEvidence[] = RELIABILITY_MATRIX): ReliabilityReadiness {
  const by = (l: ReliabilityEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    infrastructurePending: by('infrastructure-pending'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = MATRIX_ADAPTERS.length; // 6
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length; // 5
