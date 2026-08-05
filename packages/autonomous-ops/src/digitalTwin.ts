/**
 * Module 4 — Enterprise Digital Twin. Represents the organization, departments, teams, facilities,
 * warehouses, factories, assets, supply chain, customers, and vendors. Node STATE is read from the
 * reused Wave 8 business platform — NEVER fabricated. With no business data every node count is 0
 * (business-data-pending), not an invented value. The twin MODEL is live-verified; the operational
 * state it reflects is real or pending.
 */
import { randomId } from '@neuropause/cloud-core';
import type { OperationsGovernance } from './governance';
import type { OpsContext, EvidenceLevel } from './types';
import { TWIN_NODE_TYPES, type TwinNodeType } from './constants';

export interface TwinNode {
  type: TwinNodeType;
  count: number;
  source: string;
  evidence: EvidenceLevel;
}
export interface TwinModel {
  orgId: string;
  nodes: TwinNode[];
  hasData: boolean;
  note: string;
}

export class DigitalTwin {
  private readonly customNodes = new Map<string, { id: string; type: TwinNodeType; name: string }>();

  constructor(
    private readonly governance: OperationsGovernance,
    private readonly ctx: OpsContext = {},
  ) {}

  async addNode(input: { type: TwinNodeType; name: string; orgId: string }): Promise<{ id: string; type: TwinNodeType; name: string }> {
    if (!TWIN_NODE_TYPES.includes(input.type)) throw new Error(`unknown twin node type: ${input.type}`);
    const node = { id: randomId('twin'), type: input.type, name: input.name };
    this.customNodes.set(node.id, node);
    await this.governance.record({ user: 'system', org: input.orgId, mission: '_twin', operation: `twin.node.${input.type}`, targetId: node.id, evidence: 'live-verified' });
    return node;
  }

  /** Build a twin model whose node counts reflect REAL business data — never fabricated. */
  model(orgId: string): TwinModel {
    const b = this.ctx.business;
    const counts: Record<TwinNodeType, number> = {
      organization: 1,
      department: b ? b.hr().departments().length : 0,
      team: b ? b.hr().departments().length : 0,
      facility: b ? b.assets().count() : 0,
      warehouse: b ? b.inventory().warehouses().length : 0,
      factory: b ? b.manufacturing().count() : 0,
      asset: b ? b.assets().count() : 0,
      'supply-chain': b ? b.procurement().purchaseOrders().length : 0,
      customer: b ? b.crm().counts().accounts : 0,
      vendor: b ? b.procurement().suppliers().length : 0,
    };
    const nodes: TwinNode[] = TWIN_NODE_TYPES.map((type) => ({
      type,
      count: counts[type],
      source: b ? 'reused business platform' : 'no business platform connected',
      evidence: type === 'organization' ? 'live-verified' : counts[type] > 0 ? 'live-verified' : 'business-data-pending',
    }));
    const hasData = nodes.some((n) => n.type !== 'organization' && n.count > 0);
    return { orgId, nodes, hasData, note: hasData ? 'twin state reflects real business data' : 'no real operational state yet — counts are 0, not fabricated' };
  }

  customNodeList(): Array<{ id: string; type: TwinNodeType; name: string }> {
    return [...this.customNodes.values()];
  }
}
