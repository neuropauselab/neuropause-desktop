/**
 * Connector subsystem composition root.
 *
 * Boots the connector service, exposes its lifecycle over the secure IPC bridge,
 * and bridges connector events two ways: to the renderer (as a broadcast) and
 * onto the Platform Event Bus (so connector activity shows up in the Timeline,
 * Activity feed, and Diagnostics alongside everything else).
 */
import type {
  ConnectorEvent,
  EnterprisePermission,
  ConnectorScopedRequest as TConnectorScopedRequest,
  ConnectorIdRequest as TConnectorIdRequest,
  ConnectorAccountRequest as TConnectorAccountRequest,
  ConnectorLogsRequest as TConnectorLogsRequest,
  ConnectorControlRequest as TConnectorControlRequest,
  ConnectorRuntimeRequest as TConnectorRuntimeRequest,
  ConnectorInspectRequest as TConnectorInspectRequest,
  M365ActionExecuteRequest as TM365ActionExecuteRequest,
  M365DraftRequest as TM365DraftRequest,
  PlatformEventInput,
} from '@neuropause/shared';
import {
  IpcChannel,
  EmptyRequest,
  ConnectorIdRequest,
  ConnectorAccountRequest,
  ConnectorScopedRequest,
  ConnectorLogsRequest,
  ConnectorControlRequest,
  ConnectorRuntimeRequest,
  ConnectorInspectRequest,
  M365ActionExecuteRequest,
  M365DraftRequest,
} from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { connectorService } from './connectorService';
import { connectorStore } from './connectorStore';
import type { ConnectorId } from '@neuropause/shared';
import { testConnection } from './connectionTest';
import { connectorControlStore } from './connectorControlStore';
import { ConnectorRuntimeSupervisor } from './connectorRuntimeSupervisor';
import { isConfigured, resolveWebhookSecret } from './credentials';
import { MANIFEST_BY_ID } from './manifests';
import { InboundWebhookRouter } from './inbound/router';
import { SlackSocketMode, type SocketLike } from './inbound/slackSocketMode';
import { syncStateStore } from '../unified/sync/syncStateInstance';
import { RateLimiter } from '../unified/sync/rateLimiter';
import { createM365Executor, type M365Executor } from './m365';
import { m365Draft } from './m365/aiDrafts';

const log = createLogger('connectors');

/** OAuth flows open the browser; allow well beyond the 5-minute auth window. */
const OAUTH_TIMEOUT_MS = 6 * 60 * 1000;
const SYNC_TIMEOUT_MS = 2 * 60 * 1000;

export interface ConnectorSubsystemDeps {
  broadcast: IpcBroadcaster;
  publish: (event: PlatformEventInput) => void;
}

export interface ConnectorSubsystem {
  handlers: SecureHandlerDef[];
  /** The P4.1 Runtime Supervisor — exposed so later increments can wire richer sync signals into it. */
  supervisor: ConnectorRuntimeSupervisor;
  /** P5 — the inbound webhook router; exposed so a relay/tunnel endpoint can hand it signed deliveries. */
  inboundWebhooks: InboundWebhookRouter;
  /** P8.3 — the confirmation-gated M365 write executor, for approved worker actions. */
  m365Executor: M365Executor;
  dispose: () => void;
}

/** Maps a connector event to a Platform Event, or null to keep it off the bus. */
function toPlatformEvent(e: ConnectorEvent): PlatformEventInput | null {
  const name = MANIFEST_BY_ID[e.connectorId]?.name ?? e.connectorId;
  const base = {
    category: 'connector' as const,
    source: 'connectors',
    actor: { kind: 'connector' as const, id: e.connectorId },
    resource: { type: 'connector', id: e.connectorId, name },
    metadata: {
      accountId: e.accountId,
      status: e.status,
      health: e.health,
      syncState: e.syncState,
      message: e.message,
    },
  };
  if (e.type === 'status') {
    if (e.status === 'connected') return { ...base, type: 'connector.connected' };
    if (e.status === 'reauth_required') return { ...base, type: 'connector.reauth_required', priority: 'high' };
    if (e.status === 'error') return { ...base, type: 'connector.error', priority: 'high' };
    if (e.status === 'disconnected') return { ...base, type: 'connector.disconnected' };
    return null; // 'connecting' is transient; don't record it
  }
  if (e.type === 'account_removed') return { ...base, type: 'connector.disconnected' };
  if (e.type === 'sync') {
    if (e.syncState === 'syncing') return { ...base, type: 'connector.sync_started' };
    if (e.syncState === 'success') return { ...base, type: 'connector.sync_completed' };
    if (e.syncState === 'error') return { ...base, type: 'connector.error', priority: 'high' };
    return null;
  }
  // 'log', 'health', 'account_added' stay off the timeline to avoid flooding it.
  return null;
}

export async function initConnectors(deps: ConnectorSubsystemDeps): Promise<ConnectorSubsystem> {
  // The connector data-sync runner is wired later by initSync: the unified SyncOrchestrator drives
  // EVERY connector adapter (GitHub included) through the one incremental-sync pipeline. Until then,
  // connectorService.sync() is a guarded no-op. (A prior standalone GitHub runner here was dead code —
  // initSync overwrote this same seam — and has been removed to keep one connector pipeline.)
  await connectorService.init();

  const onEvent = (e: ConnectorEvent): void => {
    deps.broadcast(IpcChannel.ConnectorEventBroadcast, e);
    const pe = toPlatformEvent(e);
    if (pe) deps.publish(pe);
  };
  connectorService.on('event', onEvent);

  // P4.1 — the Runtime Supervisor: projects each account's runtime state off the SAME event stream,
  // emits from→to lifecycle transitions, and owns operator controls (pause/resume/disable/enable).
  // It observes ConnectorService; it does not replace it.
  await connectorControlStore.load();
  const supervisor = new ConnectorRuntimeSupervisor({
    events: connectorService,
    controls: connectorControlStore,
    getAccount: (c, a) => connectorStore.get(c, a),
    listAccounts: () => connectorStore.all(),
    isConfigured: (id) => {
      const m = MANIFEST_BY_ID[id];
      return m ? isConfigured(m) : false;
    },
    getLogs: (id) => connectorService.logFeed(id),
    broadcast: (evt) => deps.broadcast(IpcChannel.ConnectorLifecycleBroadcast, evt),
  });
  supervisor.prime();
  // A paused account / disabled connector skips manual sync (scheduled-path enforcement lands with the
  // orchestrator changes in Increment 3).
  connectorService.setControlGate((c, a) => supervisor.isSyncSuppressed(c, a));

  /**
   * P9 — a REAL provider round-trip before "Connected" is shown.
   *
   * `checkHealth` is structural and pings nothing, by design and by its own
   * header. This is the missing half: it proves the credential works and, more
   * importantly, resolves a STABLE provider account id — the thing
   * `externalId` was declared for and almost never had.
   */
  connectorService.setConnectionTester((connectorId, accountId) =>
    testConnection(connectorId as ConnectorId, accountId, {
      getAccessToken: (c, a) => connectorService.getValidAccessToken(c, a),
      rate: new RateLimiter(200),
    }),
  );

  // P2.4 — Microsoft 365 write executor: audited, confirmation-gated Graph writes on the same account/token.
  const m365 = createM365Executor({
    getToken: (c, a) => connectorService.getValidAccessToken(c, a),
    publish: deps.publish,
    rate: new RateLimiter(200),
    recordActivity: (c, a, level, message) => connectorService.recordWrite(c, a, level, message),
    health: syncStateStore,
    manifestName: (c) => MANIFEST_BY_ID[c]?.name ?? c,
    grantedScopes: (c, a) => connectorStore.get(c, a)?.grantedScopes ?? [],
  });

  // P5 — inbound webhook / realtime runtime. Verified deliveries (relay/tunnel) via handle() and
  // pre-authenticated Socket Mode events via triggerSync() both funnel a targeted incremental sync
  // through the EXISTING connector sync path — no new pipeline. The router is exposed on the subsystem
  // so a later relay endpoint can hand it signed deliveries; Slack Socket Mode is the desktop-native
  // transport and starts only when a Slack app-level token is configured (inert otherwise).
  const inboundWebhooks = new InboundWebhookRouter({
    resolveSecret: (connectorId) => {
      const m = MANIFEST_BY_ID[connectorId];
      return m ? resolveWebhookSecret(m) : null;
    },
    accountsFor: (connectorId) =>
      connectorStore.byConnector(connectorId).filter((a) => a.status === 'connected').map((a) => a.id),
    requestSync: (c, a) => connectorService.sync(c, a),
    now: () => Date.now(),
  });

  const slackAppToken = process.env.NEUROPAUSE_SLACK_APP_TOKEN?.trim();
  const WebSocketCtor = (globalThis as unknown as { WebSocket?: new (u: string) => SocketLike }).WebSocket;
  let slackSocket: SlackSocketMode | null = null;
  if (slackAppToken && WebSocketCtor) {
    const makeSocket = WebSocketCtor; // narrowed capture for the connect closure
    slackSocket = new SlackSocketMode({
      appToken: slackAppToken,
      openConnection: async (appToken) => {
        const res = await fetch('https://slack.com/api/apps.connections.open', {
          method: 'POST',
          headers: { Authorization: `Bearer ${appToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const data = (await res.json()) as { ok: boolean; url?: string; error?: string };
        if (!data.ok || !data.url) throw new Error(`apps.connections.open: ${data.error ?? 'no url'}`);
        return data.url;
      },
      connect: (url) => new makeSocket(url),
      onEvent: () => void inboundWebhooks.triggerSync('slack'),
    });
    void slackSocket.start();
    log.info('Slack Socket Mode enabled');
  } else if (slackAppToken) {
    // Electron 30's main process (Node 20) exposes no global WebSocket unless launched with
    // --experimental-websocket, and `ws` is not a dependency — so realtime Slack is opt-in at the
    // RUNTIME level, not just by token. Verification + routing (handle()) still serve a relay/tunnel.
    log.warn(
      'Slack app-level token set, but this runtime has no WebSocket implementation; Socket Mode disabled. Add the "ws" package or launch with --experimental-websocket to enable realtime Slack.',
    );
  }

  const handlers: SecureHandlerDef[] = [
    { channel: IpcChannel.ConnectorsList, schema: EmptyRequest, handler: () => connectorService.list() },
    {
      channel: IpcChannel.ConnectorGet,
      schema: ConnectorIdRequest,
      handler: (p) => connectorService.get((p as TConnectorIdRequest).connectorId),
    },
    { channel: IpcChannel.ConnectorStats, schema: EmptyRequest, handler: () => connectorService.stats() },
    {
      channel: IpcChannel.ConnectorConnect,
      schema: ConnectorIdRequest,
      audit: true,
      timeoutMs: OAUTH_TIMEOUT_MS,
      handler: (p) => connectorService.connect((p as TConnectorIdRequest).connectorId),
    },
    {
      channel: IpcChannel.ConnectorDisconnect,
      schema: ConnectorAccountRequest,
      audit: true,
      handler: (p) => {
        const r = p as TConnectorAccountRequest;
        return connectorService.disconnect(r.connectorId, r.accountId);
      },
    },
    {
      channel: IpcChannel.ConnectorReconnect,
      schema: ConnectorAccountRequest,
      audit: true,
      timeoutMs: OAUTH_TIMEOUT_MS,
      handler: (p) => {
        const r = p as TConnectorAccountRequest;
        return connectorService.reconnect(r.connectorId, r.accountId);
      },
    },
    {
      channel: IpcChannel.ConnectorRefresh,
      schema: ConnectorAccountRequest,
      audit: true,
      handler: (p) => {
        const r = p as TConnectorAccountRequest;
        return connectorService.refresh(r.connectorId, r.accountId);
      },
    },
    {
      channel: IpcChannel.ConnectorSync,
      schema: ConnectorScopedRequest,
      audit: true,
      timeoutMs: SYNC_TIMEOUT_MS,
      handler: (p) => {
        const r = p as TConnectorScopedRequest;
        return connectorService.sync(r.connectorId, r.accountId ?? null);
      },
    },
    {
      channel: IpcChannel.ConnectorHealthCheck,
      schema: ConnectorScopedRequest,
      handler: (p) => {
        const r = p as TConnectorScopedRequest;
        return connectorService.checkHealth(r.connectorId, r.accountId ?? null);
      },
    },
    {
      channel: IpcChannel.ConnectorLogs,
      schema: ConnectorLogsRequest,
      handler: (p) => connectorService.logFeed((p as TConnectorLogsRequest).connectorId),
    },
    // P4.1 — runtime state read + operator controls (pause/resume/disable/enable).
    {
      channel: IpcChannel.ConnectorRuntime,
      schema: ConnectorRuntimeRequest,
      handler: (p) => supervisor.runtimeView((p as TConnectorRuntimeRequest).connectorId),
    },
    {
      channel: IpcChannel.ConnectorControl,
      schema: ConnectorControlRequest,
      audit: true,
      handler: (p) => {
        const r = p as TConnectorControlRequest;
        return supervisor.control(r.connectorId, r.accountId ?? null, r.action);
      },
    },
    {
      channel: IpcChannel.ConnectorInspect,
      schema: ConnectorInspectRequest,
      handler: (p) => supervisor.inspect((p as TConnectorInspectRequest).connectorId),
    },
    // P2.4 — Microsoft 365 write actions (audited, confirmation-gated) + AI drafting.
    { channel: IpcChannel.M365ActionList, schema: EmptyRequest, handler: () => m365.list() },
    {
      channel: IpcChannel.M365ActionExecute,
      schema: M365ActionExecuteRequest,
      audit: true,
      timeoutMs: SYNC_TIMEOUT_MS,
      handler: (p) => {
        const r = p as TM365ActionExecuteRequest;
        return m365.execute(r.connectorId, r.accountId, r.actionId, r.params, r.confirmed);
      },
    },
    {
      channel: IpcChannel.M365Draft,
      schema: M365DraftRequest,
      timeoutMs: SYNC_TIMEOUT_MS,
      handler: (p) => {
        const r = p as TM365DraftRequest;
        return m365Draft(r.kind, r.instruction, r.context);
      },
    },
  ];

  log.info('Connector subsystem initialized', { handlers: handlers.length });

  return {
    handlers: gateConnectorHandlers(handlers),
    supervisor,
    inboundWebhooks,
    // P8.3 — the confirmation-gated M365 write executor, so approved worker actions can run it.
    m365Executor: m365,
    dispose: () => {
      slackSocket?.stop();
      supervisor.dispose();
      connectorService.off('event', onEvent);
    },
  };
}

/**
 * P4.1 — connector RBAC. Reads require `connectors:read`; every mutation requires `connectors:manage`
 * (fail-safe: an unclassified channel defaults to the stricter `manage`). Enforced by the secure bridge's
 * injected authorizer — the seeded Owner holds both, and Viewer/Member get read, Manager+ get manage.
 * Mirrors the enterprise `withEnterpriseAuthz` pattern; no bridge changes.
 */
const CONNECTOR_READ_CHANNELS = new Set<string>([
  IpcChannel.ConnectorsList,
  IpcChannel.ConnectorGet,
  IpcChannel.ConnectorStats,
  IpcChannel.ConnectorLogs,
  IpcChannel.ConnectorRuntime,
  IpcChannel.ConnectorInspect,
  IpcChannel.M365ActionList,
  IpcChannel.M365Draft,
  // NOTE: ConnectorHealthCheck is intentionally NOT a read — it performs proactive token rotation
  // (maybeRotate → refresh), a manage-level side effect, so it falls through to connectors:manage.
]);

function gateConnectorHandlers(defs: SecureHandlerDef[]): SecureHandlerDef[] {
  return defs.map((d) => ({
    ...d,
    requireAuth: true,
    permission: (CONNECTOR_READ_CHANNELS.has(d.channel) ? 'connectors:read' : 'connectors:manage') as EnterprisePermission,
  }));
}
