/**
 * EPIC 11 — AI Workspace Context. Assembles a unified context from CRM / ERP / calendar / email / files
 * / tasks — but ONLY from connectors that are actually active (configured + verified). A source with no
 * active connector is reported unavailable, not fabricated. The context carries connector availability +
 * entity descriptors, not real customer data (which is business-data-pending).
 */
import { CONTEXT_SOURCES, type ContextSource, type ConnectorCategory } from './constants';
import type { ConnectorRuntime } from './connectorRuntime';
import type { EnterpriseConnectivityGovernance } from './governance';

export interface ContextSlice {
  source: ContextSource;
  available: boolean;
  connectorSystem: string | null;
}

export interface WorkspaceContextResult {
  slices: ContextSlice[];
  availableCount: number;
  note: string;
}

const SOURCE_CATEGORY: Record<ContextSource, ConnectorCategory | null> = {
  crm: 'crm',
  erp: 'erp',
  calendar: 'productivity',
  email: 'communication',
  files: 'storage',
  tasks: null,
};

export interface ContextDeps {
  connectors: ConnectorRuntime;
}

export class WorkspaceContext {
  constructor(
    private readonly deps: ContextDeps,
    private readonly gov: EnterpriseConnectivityGovernance,
    private readonly operator: string,
  ) {}

  sources(): readonly ContextSource[] {
    return CONTEXT_SOURCES;
  }

  /** Assemble context — a source is available ONLY if an active connector backs it. */
  async assemble(): Promise<WorkspaceContextResult> {
    const slices: ContextSlice[] = CONTEXT_SOURCES.map((source) => {
      const category = SOURCE_CATEGORY[source];
      const active = category ? this.deps.connectors.list(category).find((c) => c.status === 'active') : undefined;
      return { source, available: Boolean(active), connectorSystem: active?.system ?? null };
    });
    const availableCount = slices.filter((s) => s.available).length;
    await this.gov.record({ actor: this.operator, customer: '_context', connector: '_workspace', epic: 'E11', operation: 'assemble-context', targetId: 'workspace', evidence: 'live-verified', decision: `${availableCount}/${slices.length} sources` });
    return { slices, availableCount, note: 'context assembled from active connectors only; source availability is real, underlying customer data is business-data-pending.' };
  }
}
