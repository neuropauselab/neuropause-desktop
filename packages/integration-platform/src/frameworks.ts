/**
 * EPICs 4–13 — reusable ADAPTER frameworks (ERP, CRM, collaboration, storage, database, HR, finance,
 * manufacturing, healthcare). One generic framework class, configured per category from the adapter
 * catalog. Every external system is REPRESENTED: connecting records an adapter descriptor that is
 * adapter-verified until a real credential is configured AND the connection is verified — it never
 * imports data, processes a payment, operates equipment, or fabricates a record. Category guards
 * (finance/healthcare/manufacturing) are carried through honestly.
 */
import { randomId } from '@neuropause/cloud-core';
import type { IntegrationGovernance } from './governance';
import type { FrameworkConfig, FrameworkCategory } from './constants';

export interface AdapterConnection {
  id: string;
  category: FrameworkCategory;
  system: string;
  status: 'represented' | 'configured' | 'verified';
  credentialRef: string | null;
  note: string;
}

export class AdapterFramework {
  private readonly connections = new Map<string, AdapterConnection>();

  constructor(
    private readonly config: FrameworkConfig,
    private readonly governance: IntegrationGovernance,
  ) {}

  category(): FrameworkCategory { return this.config.category; }
  systems(): string[] { return this.config.systems; }
  entities(): string[] { return this.config.entities; }
  guard(): string | undefined { return this.config.guard; }
  epic(): string { return this.config.epic; }

  /** Represent an adapter for a system — adapter-verified; nothing is imported, charged, or operated. */
  async connect(input: { system: string; org?: string }): Promise<AdapterConnection> {
    if (!this.config.systems.includes(input.system)) throw new Error(`${input.system} is not a supported ${this.config.category} system`);
    const conn: AdapterConnection = {
      id: randomId('conn'),
      category: this.config.category,
      system: input.system,
      status: 'represented',
      credentialRef: null,
      note: this.config.guard ? `${input.system} represented — ${this.config.guard}` : `${input.system} represented — adapter-verified until configured and verified`,
    };
    this.connections.set(conn.id, conn);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', integration: `_${this.config.category}`, connector: input.system, epic: this.config.epic, operation: `${this.config.category}.connect`, targetId: conn.id, evidence: 'adapter-verified' });
    return conn;
  }

  /** Attach a credential REFERENCE (never a value) — moves to 'configured'. */
  configure(connId: string, credentialRef: string): AdapterConnection {
    const c = this.require(connId);
    c.credentialRef = credentialRef;
    c.status = 'configured';
    return c;
  }

  /** Verify with a real connection proof — 'verified' only with proof; never active without it. */
  async verify(connId: string, proof: { verified: boolean; evidenceRef: string }, org?: string): Promise<AdapterConnection> {
    const c = this.require(connId);
    if (c.status !== 'configured') throw new Error('adapter must be configured before verification');
    c.status = proof.verified && proof.evidenceRef ? 'verified' : 'configured';
    await this.governance.record({ operator: 'system', org: org ?? '_ops', integration: `_${this.config.category}`, connector: c.system, epic: this.config.epic, operation: `${this.config.category}.verify`, targetId: c.id, evidence: c.status === 'verified' ? 'live-verified' : 'adapter-verified', decision: proof.evidenceRef });
    return c;
  }

  private require(id: string): AdapterConnection {
    const c = this.connections.get(id);
    if (!c) throw new Error(`no connection ${id}`);
    return c;
  }

  list(): AdapterConnection[] { return [...this.connections.values()]; }
  verifiedCount(): number { return [...this.connections.values()].filter((c) => c.status === 'verified').length; }
  count(): number { return this.connections.size; }
}
