/**
 * Module 14 — Runtime APIs / composition root. `createConnectivityPlatform(runtime, …)`
 * assembles the Wave 2 connectivity layer on the EXISTING platform: it reuses the
 * connectors runtime (registry + executor + governance) sharing the ONE encrypted
 * vault, the security KeyManager (envelope encryption), the integrations transport +
 * credential manager, and the runtime audit chain + event bus. It adds the tenant
 * lifecycle, the sync orchestrator, the seven adapters, unified search, the dashboard,
 * and governance — and exposes them as one coherent API.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { KeyManager } from '@neuropause/security';
import { FetchHttpClient, CredentialManager, type HttpClient } from '@neuropause/integrations';
import { createConnectorPlatform, defineConnector, type ConnectorRegistry, type ConnectorDefinition } from '@neuropause/connectors';
import type { NemsPlatform } from '@neuropause/nems';
import type { SqlDriver } from '@neuropause/persistence';
import { CONNECTIVITY_VERSION, type LifecycleState } from './constants';
import { CONNECTIVITY_MATRIX, connectivityReadiness, type ConnectorEvidence, type ConnectivityReadiness } from './evidence';
import { EncryptedSecretVault, CredentialService } from './credentials';
import { ConnectorLifecycle, type ConnectionRecord } from './lifecycle';
import { ConnectivityGovernance } from './governance';
import { SyncOrchestrator } from './sync';
import { EnterpriseSearch, nemsSearchSource } from './search';
import { ConnectorDashboard } from './dashboard';
import { GitHubConnector } from './providers/github';
import { GmailConnector } from './providers/gmail';
import { CalendarConnector } from './providers/calendar';
import { SlackConnector } from './providers/slack';
import { JiraConnector } from './providers/jira';
import { NotionConnector } from './providers/notion';
import { PostgresConnector } from './providers/postgres';
import type { TransportOptions } from './httpConnector';

type AdapterOpts = Partial<TransportOptions> & { token?: string };

/** Minimal connector definitions installed into the reused registry (Module 1/2 registry). */
const DEF_SPECS: Array<{ id: string; name: string; category: string; auth: 'oauth2' | 'pat' | 'api_key' | 'basic' | 'none' }> = [
  { id: 'github', name: 'GitHub', category: 'vcs', auth: 'pat' },
  { id: 'gmail', name: 'Gmail', category: 'email', auth: 'oauth2' },
  { id: 'google-calendar', name: 'Google Calendar', category: 'calendar', auth: 'oauth2' },
  { id: 'slack', name: 'Slack', category: 'chat', auth: 'oauth2' },
  { id: 'jira', name: 'Jira', category: 'project', auth: 'oauth2' },
  { id: 'notion', name: 'Notion', category: 'docs', auth: 'oauth2' },
  { id: 'postgresql', name: 'PostgreSQL', category: 'database', auth: 'none' },
];

function providerDefinition(spec: (typeof DEF_SPECS)[number]): ConnectorDefinition {
  return defineConnector({
    id: spec.id,
    name: spec.name,
    version: '2.0.0-preview.1',
    category: spec.category,
    auth: { type: spec.auth },
    capabilities: ['sync', 'read'],
    permissions: [`${spec.id}:read`],
    actions: [{ name: 'sync', permissions: [], execute: async () => ({ ok: true }) }],
    health: () => ({ status: 'ok' }),
  });
}

/** Module 1 — Connector Manager: install / connect / lifecycle over the reused registry. */
export class ConnectorManager {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly lifecycle: ConnectorLifecycle,
  ) {}

  definitions(): string[] {
    return this.registry.list().map((e) => e.def.id);
  }
  install(tenantId: string, connectorId: string, opts: { permissions?: string[]; scopes?: string[] } = {}): ConnectionRecord {
    if (!this.registry.has(connectorId)) throw new Error(`unknown connector '${connectorId}'`);
    return this.lifecycle.install(tenantId, connectorId, opts);
  }
  connect(tenantId: string, connectorId: string, opts: { expiresAt?: number } = {}): ConnectionRecord {
    return this.lifecycle.connect(tenantId, connectorId, opts);
  }
  disconnect(tenantId: string, connectorId: string): ConnectionRecord {
    return this.lifecycle.disconnect(tenantId, connectorId);
  }
  disable(tenantId: string, connectorId: string): ConnectionRecord {
    return this.lifecycle.disable(tenantId, connectorId);
  }
  markExpired(tenantId: string, connectorId: string): ConnectionRecord {
    return this.lifecycle.markExpired(tenantId, connectorId);
  }
  state(tenantId: string, connectorId: string): ConnectionRecord | undefined {
    return this.lifecycle.get(tenantId, connectorId);
  }
  list(tenantId: string): ConnectionRecord[] {
    return this.lifecycle.list(tenantId);
  }
  health(tenantId: string): Array<{ connectorId: string; state: LifecycleState; healthy: boolean }> {
    return this.lifecycle.health(tenantId);
  }
  diagnostics(tenantId: string, connectorId: string) {
    return this.lifecycle.diagnostics(tenantId, connectorId);
  }
  can(tenantId: string, connectorId: string, permission: string): boolean {
    return this.lifecycle.can(tenantId, connectorId, permission);
  }
}

export interface ConnectivityPlatformOptions {
  clock?: Clock;
  http?: HttpClient;
  keyManager?: KeyManager;
  nems?: NemsPlatform;
  driver?: SqlDriver;
}

export interface ConnectorHealthReport {
  definitions: Array<{ id: string; status: string }>;
  connections: Array<{ connectorId: string; state: LifecycleState; healthy: boolean }>;
}

export interface ConnectivityPlatform {
  version: string;
  connectors(): ConnectorManager;
  connectorRegistry(): ConnectorRegistry;
  lifecycle(): ConnectorLifecycle;
  connectorHealth(tenantId?: string): ConnectorHealthReport;
  sync(): SyncOrchestrator;
  credentials(): CredentialService;
  vault(): EncryptedSecretVault;
  governance(): ConnectivityGovernance;
  search(): EnterpriseSearch;
  dashboard(): ConnectorDashboard;
  matrix(): ConnectorEvidence[];
  readiness(): ConnectivityReadiness;
  // Provider adapters (Modules 4–10)
  github(opts?: AdapterOpts): GitHubConnector;
  gmail(opts?: AdapterOpts): GmailConnector;
  calendar(opts?: AdapterOpts): CalendarConnector;
  slack(opts?: AdapterOpts): SlackConnector;
  jira(opts: AdapterOpts & { baseUrl: string }): JiraConnector;
  notion(opts?: AdapterOpts): NotionConnector;
  postgres(driver?: SqlDriver): PostgresConnector;
}

export function createConnectivityPlatform(runtime: EnterpriseRuntime, options: ConnectivityPlatformOptions = {}): ConnectivityPlatform {
  const clock = options.clock ?? systemClock;
  const http = options.http ?? new FetchHttpClient();
  const keyManager = options.keyManager ?? new KeyManager();

  // ONE encrypted vault, shared with the reused connectors runtime.
  const vault = new EncryptedSecretVault(keyManager, clock);
  const connectorPlatform = createConnectorPlatform(runtime, { clock, vault });
  const registry = connectorPlatform.connectorRegistry();
  for (const spec of DEF_SPECS) registry.install(providerDefinition(spec));

  const credManager = new CredentialManager(vault, clock);
  const credentials = new CredentialService(credManager, clock);
  const governance = new ConnectivityGovernance(runtime, clock);
  const lifecycle = new ConnectorLifecycle(clock, {
    onTransition: (rec, from, to) => {
      void governance.recordLifecycle(rec.tenantId, rec.connectorId, from, to);
    },
  });
  const orchestrator = new SyncOrchestrator(clock, governance, lifecycle);
  const search = new EnterpriseSearch();
  if (options.nems) search.register(nemsSearchSource(options.nems));
  const dashboard = new ConnectorDashboard(lifecycle, orchestrator);
  const manager = new ConnectorManager(registry, lifecycle);

  const requireDriver = (driver?: SqlDriver): SqlDriver => {
    const d = driver ?? options.driver;
    if (!d) throw new Error('postgres connector requires a SqlDriver (pass one, or set options.driver)');
    return d;
  };

  return {
    version: CONNECTIVITY_VERSION,
    connectors: () => manager,
    connectorRegistry: () => registry,
    lifecycle: () => lifecycle,
    connectorHealth: (tenantId?: string): ConnectorHealthReport => ({
      definitions: registry.health().map((h) => ({ id: h.id, status: h.health.status })),
      connections: tenantId ? lifecycle.health(tenantId) : [],
    }),
    sync: () => orchestrator,
    credentials: () => credentials,
    vault: () => vault,
    governance: () => governance,
    search: () => search,
    dashboard: () => dashboard,
    matrix: () => CONNECTIVITY_MATRIX,
    readiness: () => connectivityReadiness(),
    github: (opts: AdapterOpts = {}) => new GitHubConnector(http, opts),
    gmail: (opts: AdapterOpts = {}) => new GmailConnector(http, opts),
    calendar: (opts: AdapterOpts = {}) => new CalendarConnector(http, opts),
    slack: (opts: AdapterOpts = {}) => new SlackConnector(http, opts),
    jira: (opts: AdapterOpts & { baseUrl: string }) => new JiraConnector(http, opts),
    notion: (opts: AdapterOpts = {}) => new NotionConnector(http, opts),
    postgres: (driver?: SqlDriver) => new PostgresConnector(requireDriver(driver)),
  };
}
