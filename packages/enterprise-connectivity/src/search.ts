/**
 * EPIC 12 — Enterprise Search. Unified / cross-system / metadata / connector search with search
 * permissions. The search runs for REAL over an index built from REPRESENTED connector metadata (system
 * names + entity descriptors) — it does NOT search real customer content (that is business-data-pending
 * and requires configured, verified connectors). Only active connectors are searchable (search
 * permissions).
 */
import { SEARCH_SCOPES, CONNECTOR_SYSTEMS, type SearchScope } from './constants';
import type { ConnectorRuntime } from './connectorRuntime';
import type { EnterpriseConnectivityGovernance } from './governance';

export interface SearchHit {
  connectorSystem: string;
  entity: string;
  scope: SearchScope;
}

export interface SearchDeps {
  connectors: ConnectorRuntime;
}

export class EnterpriseSearch {
  constructor(
    private readonly deps: SearchDeps,
    private readonly gov: EnterpriseConnectivityGovernance,
    private readonly operator: string,
  ) {}

  scopes(): readonly SearchScope[] {
    return SEARCH_SCOPES;
  }

  /** Search over represented connector metadata. Only ACTIVE connectors are searchable. */
  async search(input: { query: string; scope?: SearchScope; onlyActive?: boolean }): Promise<{ query: string; hits: SearchHit[]; searchedConnectors: number }> {
    const scope = input.scope ?? 'unified';
    const onlyActive = input.onlyActive ?? true;
    const connectors = this.deps.connectors.list().filter((c) => (onlyActive ? c.status === 'active' : true));
    const q = input.query.toLowerCase();
    const hits: SearchHit[] = [];
    for (const c of connectors) {
      const entities = CONNECTOR_SYSTEMS[c.category].entities;
      for (const entity of entities) {
        if (c.system.toLowerCase().includes(q) || entity.toLowerCase().includes(q)) hits.push({ connectorSystem: c.system, entity, scope });
      }
    }
    await this.gov.record({ actor: this.operator, customer: '_search', connector: '_search', epic: 'E12', operation: `search.${scope}`, targetId: input.query, evidence: 'live-verified', decision: `${hits.length} hits over ${connectors.length} connectors` });
    return { query: input.query, hits, searchedConnectors: connectors.length };
  }

  /** Search permissions — only active connectors are searchable. */
  permissions(): { searchableConnectors: number } {
    return { searchableConnectors: this.deps.connectors.activeCount() };
  }
}
