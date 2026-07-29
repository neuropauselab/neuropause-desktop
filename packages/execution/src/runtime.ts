/**
 * Module 1 — Universal Connector Runtime. The registry of the 22 connector descriptors,
 * queryable by id and category. Additional connectors register at runtime. It holds
 * descriptors only; the execution engine (Module 2) executes against them.
 */
import { UNIVERSAL_CONNECTORS } from './connectors';
import type { ConnectorDescriptor } from './types';

export class UniversalConnectorRuntime {
  private readonly descriptors = new Map<string, ConnectorDescriptor>();

  constructor(seed: ConnectorDescriptor[] = UNIVERSAL_CONNECTORS) {
    for (const c of seed) this.descriptors.set(c.id, c);
  }

  register(descriptor: ConnectorDescriptor): void {
    this.descriptors.set(descriptor.id, descriptor);
  }
  get(id: string): ConnectorDescriptor | undefined {
    return this.descriptors.get(id);
  }
  list(): ConnectorDescriptor[] {
    return [...this.descriptors.values()];
  }
  categories(): string[] {
    return [...new Set(this.list().map((c) => c.category))];
  }
  count(): number {
    return this.descriptors.size;
  }
  /** Connectors whose live execution is infra-pending (SaaS) vs live-verified (generic). */
  liveVerified(): ConnectorDescriptor[] {
    return this.list().filter((c) => c.evidence === 'live-verified');
  }
}
