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
import { connectorService, ownedByViewer, type OwnedConnectorEvent } from './connectorService';
import { connectorVault } from './connectorVault';
import { connectorStore } from './connectorStore';
import type { ConnectorId } from '@neuropause/shared';
import { testConnection } from './connectionTest';
import { connectorControlStore } from './connectorControlStore';
import { ConnectorRuntimeSupervisor, lifecycleToWire } from './connectorRuntimeSupervisor';
import { runOutsidePrincipal } from '../tenancy/backgroundPrincipal';
import { isConfigured, resolveWebhookSecret } from './credentials';
import { MANIFEST_BY_ID } from './manifests';
import { InboundWebhookRouter } from './inbound/router';
import { SlackSocketMode, type SocketLike } from './inbound/slackSocketMode';
import { syncStateStore } from '../unified/sync/syncStateInstance';
import { RateLimiter } from '../unified/sync/rateLimiter';
import { HttpClient } from '../unified/sync/http';
import { createM365Executor, ALL_M365_ACTIONS, type M365Executor } from './m365';
import { governedSend, createGovernedSendPorts, type GovernedSendResult } from '../cst/sendTransition';
import type { ConnectorWriteResult } from '@neuropause/shared';
import { m365Draft } from './m365/aiDrafts';

const log = createLogger('connectors');

/** OAuth flows open the browser; allow well beyond the 5-minute auth window. */
const OAUTH_TIMEOUT_MS = 6 * 60 * 1000;
const SYNC_TIMEOUT_MS = 2 * 60 * 1000;

export interface ConnectorSubsystemDeps {
  broadcast: IpcBroadcaster;
  publish: (event: PlatformEventInput) => void;
  /**
   * P10 — the active workspace, the boundary every credential and connection
   * is scoped to. Required: a build that cannot say which workspace it is in
   * must not be able to spend a credential.
   */
  workspaceId: () => string;
  /**
   * P13C Phase H — the authoritative actor identity for a governed consequential
   * transition (the `mail.send` CST boundary). Identity plumbing ONLY: it supplies
   * WHO initiated the request, wired from the application's existing identity
   * authority. It must NOT be derived from the workspace/tenant, the connector
   * account, an email in a payload, or Graph credentials, and must NOT authorize,
   * resolve permissions, or default to a fallback identity. `null` ⇒ no known actor
   * ⇒ the transition follows the missing-identity governance path (DENY; no send).
   * The actor is distinct from `workspaceId()` (tenant ≠ actor).
   */
  actor: () => string | null;
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

/**
 * P13C Phase H — map the governed send outcome onto the existing ConnectorWriteResult
 * WITHOUT letting a 202 masquerade as a verified success. `ok:true` here means the
 * provider ACKNOWLEDGED the request (accepted for delivery), NEVER "verified". The
 * structured outcome is carried in `data.outcome`, so downstream code reads the
 * outcome class directly and never reconstructs semantics from the message string.
 */
function mapSendOutcome(g: GovernedSendResult, confirmed: boolean): ConnectorWriteResult {
  const data: Record<string, string | number | boolean | null> = { outcome: g.semanticOutcome };
  switch (g.semanticOutcome) {
    case 'ACKNOWLEDGED':
      return {
        ok: true, // provider acceptance — ACKNOWLEDGED, NOT verified business success
        message: g.summary
          ? `${g.summary} — accepted by Microsoft Graph (queued; delivery not independently verified).`
          : 'Accepted by Microsoft Graph (queued; delivery not independently verified).',
        data,
      };
    case 'UNKNOWN':
      return {
        ok: false,
        message:
          'Outcome UNKNOWN — the request was transmitted but no response was received; it was NOT retried. Reconcile before any resend.',
        data,
      };
    case 'EXECUTION_FAILED':
      return { ok: false, message: g.summary ?? 'Send failed — the provider rejected the request.', data };
    case 'HOLD':
      return {
        ok: false,
        requiresConfirmation: !confirmed,
        message: !confirmed
          ? 'This send modifies data and needs explicit confirmation.'
          : 'Held for reconciliation — a prior identical send is unconfirmed and was not re-sent.',
        data,
      };
    case 'ESCALATE':
      return { ok: false, message: 'Escalated for human review.', data };
    case 'DENIED':
    default:
      return { ok: false, message: 'Not authorized — reconnect this account or check its permissions.', data };
  }
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
  /**
   * BOUND BEFORE ANYTHING READS A CREDENTIAL — which means before `init()`.
   *
   * `connectorService.init()` calls `connectorStore.all()`, so binding after it
   * meant the first read of the connection list happened outside the workspace
   * boundary. Moved above the call, where the comment already claimed it was.
   */
  connectorService.bindWorkspace(deps.workspaceId);
  connectorStore.bindWorkspace(deps.workspaceId);
  // P13C Round 6 — `disabled` was an install-wide kill switch. Same resolver.
  connectorControlStore.bindWorkspace(deps.workspaceId);

  await connectorService.init();

  /**
   * Say out loud what the workspace boundary orphaned.
   *
   * A credential written before this boundary existed has no workspace, and is
   * deliberately NOT adopted by whichever workspace happens to be active —
   * guessing an owner for a secret is the one thing worse than losing it. But
   * the consequence for an existing user is that connections silently vanish
   * from the UI, so the count belongs in the log and on the wire rather than
   * only in a file nobody reads.
   */
  const unscoped = await connectorVault.migrationRequired();
  const unclaimed = connectorStore.unclaimed();
  if (unscoped.length > 0 || unclaimed.length > 0) {
    log.warn('Connections from before workspace scoping need reconnecting', {
      credentials: unscoped.length,
      connections: unclaimed.length,
      connectors: [...new Set([...unscoped, ...unclaimed].map((c) => c.connectorId))],
    });
  }

  /**
   * The workspace the WINDOW is showing — never the one a job is acting as.
   *
   * P13C ROUND 9 — FINDING 6. `deps.workspaceId` deliberately prefers a
   * background principal, which is correct for every WRITE: the fanned-out sync
   * must read, stamp and store as the workspace it is syncing. It is exactly
   * wrong for deciding what a window may see, because during that pass the
   * resolver names workspace B while the user is looking at A — so an
   * unconditional broadcast pushed B's connector and account ids into A's
   * window on every scheduled sync.
   *
   * `runOutsidePrincipal` drops the job's principal for the length of this call
   * and nothing else, so the resolver falls back to the SESSION's workspace.
   * It grants nothing: the answer is what the signed-in user would see anyway.
   * `backgroundPrincipal.ts` documents this as its intended use.
   */
  const viewerWorkspace = (): string | null => {
    const id = runOutsidePrincipal(() => deps.workspaceId());
    return id === undefined || id === null || id === '' ? null : id;
  };

  /** Whether a stamped record belongs to the workspace on screen. Unowned ⇒ nobody's. */
  const onScreen = (owner: string | null): boolean => ownedByViewer(owner, viewerWorkspace());

  const onEvent = (e: OwnedConnectorEvent): void => {
    const { workspaceId: owner, ...wire } = e;
    /**
     * The renderer sees its OWN workspace's connector activity. A live event
     * carries an account id and the provider's error text, which is the same
     * disclosure the log feed was fixed for — a broadcast is just a read
     * nobody asked for.
     */
    if (onScreen(owner)) deps.broadcast(IpcChannel.ConnectorEventBroadcast, wire);
    /**
     * The Platform Event Bus is NOT gated here, and that is deliberate: it
     * stamps every event with the tenant resolved at PUBLISH time, so an event
     * published inside the fan-out is durably owned by the workspace being
     * synced and is filtered on read by the bus's own boundary. Dropping it
     * here would delete a timeline entry rather than protect one.
     */
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
    // The boundary the accounts, the credentials and the activity feed already use.
    workspaceId: deps.workspaceId,
    // Same viewer test as the connector event stream: a transition names an
    // account, so it reaches the window that owns that account or no window.
    broadcast: (evt) => {
      if (onScreen(evt.workspaceId)) {
        deps.broadcast(IpcChannel.ConnectorLifecycleBroadcast, lifecycleToWire(evt));
      }
    },
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
  // The identity/scope/token/transport seams are named ONCE so the P13C Phase-H CST
  // send adapter (mail.send) reuses the SAME authorities as the executor — one
  // authority feeding one kernel verdict, never a second, disagreeing gate.
  const m365Rate = new RateLimiter(200);
  const m365GetToken = (c: string, a: string): Promise<string | null> =>
    connectorService.getValidAccessToken(c, a);
  const m365GrantedScopes = (c: string, a: string): string[] => connectorStore.get(c, a)?.grantedScopes ?? [];
  // P13C Round 6 — the same workspace-scoped resolve, used as an authorization
  // decision rather than as a scope lookup that happens to return nothing.
  const m365OwnsAccount = (c: string, a: string): boolean => connectorStore.get(c, a) !== null;
  const m365 = createM365Executor({
    getToken: m365GetToken,
    publish: deps.publish,
    rate: m365Rate,
    recordActivity: (c, a, level, message) => connectorService.recordWrite(c, a, level, message),
    health: syncStateStore,
    manifestName: (c) => MANIFEST_BY_ID[c]?.name ?? c,
    grantedScopes: m365GrantedScopes,
    ownsAccount: m365OwnsAccount,
  });
  // P13C Phase H — the ONE CST boundary for the `mail.send` consequential action.
  // Process-lifetime governance stores (claim + idempotency): NeuroPause-boundary
  // duplicate suppression only — NOT provider idempotency, NOT crash-durable
  // (in-memory; declared Node-20 limit).
  const m365SendPorts = createGovernedSendPorts();
  const mailSendAction = ALL_M365_ACTIONS.find((a) => a.id === 'mail.send') ?? null;

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
      handler: async (p) => {
        const r = p as TM365ActionExecuteRequest;
        // P13C Phase H — the `mail.send` consequential action is GOVERNED through the
        // single CST boundary; there is NO direct executor bypass for it from this
        // call site. Every other write action keeps the existing executor path
        // unchanged (scope: exactly one governed transition). H9-refined: the effect
        // is the pure Graph send, so typed transport errors survive to the adapter
        // (NetworkError → UNKNOWN, HttpError/AuthError → EXECUTION_FAILED, 202 →
        // ACKNOWLEDGED). A 202 is ACKNOWLEDGED, never a verified business outcome.
        if (r.actionId === 'mail.send' && mailSendAction) {
          const g = await governedSend({
            connectorId: r.connectorId,
            accountId: r.accountId,
            action: mailSendAction,
            params: r.params,
            confirmed: r.confirmed,
            tenantId: deps.workspaceId(),
            actorId: deps.actor() ?? '', // authoritative identity; null ⇒ DENY (no send)
            policyVersion: 'm365-send-policy-1',
            ownsAccount: m365OwnsAccount(r.connectorId, r.accountId),
            grantedScopes: m365GrantedScopes(r.connectorId, r.accountId),
            getToken: () => m365GetToken(r.connectorId, r.accountId),
            makeHttp: (key, getToken, rate) => new HttpClient(key, getToken, rate),
            rate: m365Rate,
            now: () => new Date().toISOString(),
            ports: m365SendPorts,
          });
          return mapSendOutcome(g, r.confirmed);
        }
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
