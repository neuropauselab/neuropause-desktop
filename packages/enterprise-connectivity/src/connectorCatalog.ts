/**
 * EPICs 3-7 — Connector Catalogs. The represented systems + entity registries for the productivity, ERP,
 * CRM, storage, and communication categories. Every system is REPRESENTED (adapter-verified); no
 * synchronized data is ever fabricated. Where the Sprint-3 integration platform has a matching adapter
 * framework (collaboration/erp/crm/storage), this reports the reuse; communication is represented
 * locally (metadata only — no message body is read).
 */
import { CONNECTOR_SYSTEMS, type ConnectorCategory } from './constants';

export interface CategoryCatalog {
  category: ConnectorCategory;
  systems: string[];
  entities: string[];
  guard: string | null;
  reusedIntegrationFramework: boolean;
}

const HAS_FRAMEWORK: Record<ConnectorCategory, boolean> = {
  productivity: true, // integration-platform 'collaboration'
  erp: true,
  crm: true,
  storage: true,
  communication: false, // represented locally — metadata only
};

export class ConnectorCatalog {
  catalog(category: ConnectorCategory): CategoryCatalog {
    const spec = CONNECTOR_SYSTEMS[category];
    return { category, systems: spec.systems, entities: spec.entities, guard: spec.guard ?? null, reusedIntegrationFramework: HAS_FRAMEWORK[category] };
  }

  all(): CategoryCatalog[] {
    return (Object.keys(CONNECTOR_SYSTEMS) as ConnectorCategory[]).map((c) => this.catalog(c));
  }

  /** The total number of represented external systems across all categories. */
  representedSystemCount(): number {
    return this.all().reduce((n, c) => n + c.systems.length, 0);
  }
}
