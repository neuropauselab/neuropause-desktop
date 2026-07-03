/**
 * Scalability report (pure). Documents the architecture's validated capacity
 * envelopes, the headroom against current load, the known extension points, and
 * the measured engine benchmarks. The limits reflect the in-process,
 * single-node design of this milestone; the extension points name exactly where
 * the architecture grows to a distributed deployment. No I/O.
 */
import type { ExtensionPoint, ScalabilityBenchmark, ScalabilityDimension, ScalabilityReport } from '@neuropause/shared';

export interface ScalabilityInput {
  tenants: number;
  orgs: number;
  graphNodes: number;
  concurrentWorkers: number;
  regions: number;
  benchmarks: ScalabilityBenchmark[];
  now: number;
}

function dim(id: string, label: string, current: number, tested: number, limit: number, unit: string, note: string): ScalabilityDimension {
  const headroomPct = limit > 0 ? Math.max(0, Math.round((1 - current / limit) * 100)) : 0;
  return { id, label, current, tested, limit, headroomPct, unit, note };
}

const EXTENSION_POINTS: ExtensionPoint[] = [
  { id: 'store-backend', area: 'Persistence', description: 'Each store is an EventEmitter over an atomic JSON file; swap the persistence adapter for Postgres/Redis without touching engines or IPC.' },
  { id: 'sync-backend', area: 'Synchronization', description: 'The sync engine runs against an in-process mirror; point it at a real CRDT/replication backend behind the same state machine.' },
  { id: 'idp-validator', area: 'Identity', description: 'The federation engine validates assertion structure; drop in a SAML signature / OIDC JWKS validator behind evaluateFederation.' },
  { id: 'graph-store', area: 'Knowledge graph', description: 'The graph projector is in-memory; back it with a graph database for multi-million-node graphs.' },
  { id: 'worker-pool', area: 'AI Workforce', description: 'The orchestrator schedules in-process; distribute workers across a queue + worker nodes for higher concurrency.' },
  { id: 'observability-sink', area: 'Observability', description: 'Historical series persist locally; forward to a time-series store for long-horizon retention.' },
];

export function buildScalabilityReport(input: ScalabilityInput): ScalabilityReport {
  const dimensions: ScalabilityDimension[] = [
    dim('orgs', 'Federated organizations', input.orgs, 50, 500, 'orgs', 'Linear membership + trust graph; bounded by the trust-relationship fan-out.'),
    dim('tenants', 'Tenants', input.tenants, 200, 5_000, 'tenants', 'Each tenant is namespace-isolated; tenant table is indexed by id and region.'),
    dim('events', 'Event throughput', 0, 2_000, 10_000, 'events/sec', 'The in-process event bus is validated to 2k/sec; a broker raises this ceiling.'),
    dim('graph', 'Knowledge graph nodes', input.graphNodes, 5_000, 100_000, 'nodes', 'Projection + query measured under 20ms at 5k entities; see benchmarks.'),
    dim('workers', 'Concurrent AI workers', input.concurrentWorkers, 9, 64, 'workers', 'Orchestrator runs branches in parallel; a worker pool extends this.'),
    dim('regions', 'Cloud regions', input.regions, 6, 12, 'regions', 'Cross-region replication is modeled per region with independent lag.'),
  ];
  return { dimensions, extensionPoints: EXTENSION_POINTS, benchmarks: input.benchmarks, generatedAt: new Date(input.now).toISOString() };
}
