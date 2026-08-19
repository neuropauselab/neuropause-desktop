/**
 * Workspace Foundation Slice 1 · LIVE WIRING — bind the domain aggregate to the
 * REAL EnterpriseModuleRegistry. READ/aggregate-only: it only ever calls each
 * governed store's already-SCOPED `count()`, so tenant isolation is inherited and
 * a missing/unregistered module degrades HONESTLY to UNAVAILABLE (never a fake 0).
 */
import type { ExecutiveSnapshot, TenantScope } from '@neuropause/shared';
import {
  composeWorkspaceDomain,
  type DomainModuleSpec,
  type WorkspaceDomainSnapshot,
  type WorkspaceDomainSources,
} from './domainAggregate';

/** A governed record store as this façade reads it — a scoped count is all it needs. */
export interface ScopedCountStore {
  count(): number;
}

/**
 * The canonical domain concepts → the governed module whose scoped store holds
 * each. moduleIds are the registry's real descriptor ids; an id with no
 * registered store degrades to UNAVAILABLE (honest, never a fabricated 0), so a
 * future rename surfaces as a gap rather than a crash.
 */
export const DOMAIN_MODULES: readonly DomainModuleSpec[] = [
  { domain: 'people', moduleId: 'hr-employees', label: 'People' },
  { domain: 'customers', moduleId: 'crm-customers', label: 'Customers' },
  { domain: 'leads', moduleId: 'leads', label: 'Leads' },
  { domain: 'opportunities', moduleId: 'opportunities', label: 'Opportunities' },
  { domain: 'projects', moduleId: 'projects', label: 'Projects' },
  { domain: 'documents', moduleId: 'documents', label: 'Documents' },
];

export interface RegistryDomainDeps {
  /** `registry.get(id)?.store ?? null` — a null store means the module is absent. */
  readonly moduleStore: (moduleId: string) => ScopedCountStore | null;
  /** The active tenant scope; null → the whole snapshot is UNKNOWN. */
  readonly scope: () => TenantScope | null;
  readonly now?: () => string;
}

/** The aggregate's sources, wired to the registry's scoped stores. READ-only. */
export function registryDomainSources(deps: RegistryDomainDeps): WorkspaceDomainSources {
  return {
    scope: deps.scope,
    now: deps.now ?? (() => new Date().toISOString()),
    moduleCount: (id) => {
      const store = deps.moduleStore(id);
      return store === null ? null : store.count(); // null = UNAVAILABLE; count() is already scoped
    },
  };
}

/** The live tenant-scoped domain snapshot over the real registry (READ/aggregate-only). */
export function workspaceDomainSnapshot(deps: RegistryDomainDeps): WorkspaceDomainSnapshot {
  return composeWorkspaceDomain(DOMAIN_MODULES, registryDomainSources(deps));
}

/**
 * Project the snapshot onto the FG-8 `ExecutiveSnapshot.workspaceDomain` field —
 * states and counts carried VERBATIM (state fidelity), so an `unavailable` module
 * stays `unavailable` end to end, never a fabricated 0.
 */
export function toWorkspaceDomainField(snap: WorkspaceDomainSnapshot): ExecutiveSnapshot['workspaceDomain'] {
  return {
    scopeResolved: snap.scopeResolved,
    slices: snap.slices.map((s) => ({
      domain: s.domain,
      moduleId: s.moduleId,
      label: s.label,
      count: s.count,
      state: s.state,
    })),
  };
}
