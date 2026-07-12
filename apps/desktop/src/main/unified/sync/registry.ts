/**
 * The adapter registry — connectorId → provider mapping. The orchestrator looks
 * up adapters here; a connector with no adapter syncs as "connection verified,
 * no data adapter yet". Part B registers GitHub, Notion, Google Calendar, and
 * Slack; adding a provider later is one `registerAdapter` call.
 */
import { describeAdapter, type AdapterCapability, type ConnectorAdapter } from './adapterSdk';

const ADAPTERS = new Map<string, ConnectorAdapter>();

export function registerAdapter(adapter: ConnectorAdapter): void {
  ADAPTERS.set(adapter.connectorId, adapter);
}

export function getAdapter(connectorId: string): ConnectorAdapter | null {
  return ADAPTERS.get(connectorId) ?? null;
}

export function adapterConnectorIds(): string[] {
  return [...ADAPTERS.keys()];
}

/** P5 — capability/schema report for every registered adapter (what each connector actually syncs). */
export function describeAdapters(): AdapterCapability[] {
  return [...ADAPTERS.values()].map(describeAdapter);
}
