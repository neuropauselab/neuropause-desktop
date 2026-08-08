/**
 * Companion subsystem (Mobile M1-03) — wires the desktop side of the mobile
 * companion: the paired-device registry, the desktop's sealed identity, the LAN
 * gateway, and the `companion:*` IPC the Settings pane uses to switch it on,
 * mint a pairing QR, list devices, and revoke them.
 *
 * The gateway hosts only view-models to the phone (never raw ERP CRUD); M1-03
 * ships the pairing + a `session.hello` proof-of-channel op, and later
 * increments register the read/write ops. If the OS keychain is unavailable the
 * identity cannot be stored, so the gateway stays disabled rather than run
 * without a persistent trust root.
 */
import { hostname } from 'node:os';
import { COMPANION_PROTOCOL_VERSION } from '@neuropause/companion-protocol';
import {
  buildFamilyDashboard,
  CompanionEnableRequest,
  CompanionRevokeRequest,
  EmptyRequest,
  IpcChannel,
  type CompanionStatusDto,
  type EnterpriseEntity,
  type EnterpriseSearchResult,
  type EnterpriseTimelinePage,
  type ExecutiveCenterSnapshot,
  type IpcBroadcaster,
  type NotificationInboxPage,
  type PlatformEvent,
  type PlatformEventType,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import type { EnterpriseModuleRegistry } from '../enterprise/framework/moduleRegistry';
import { createLogger } from '../logger';
import { companionDeviceStore } from './deviceRegistryInstance';
import { toCompanionDeviceDto } from './deviceRegistryStore';
import { loadOrCreateIdentity } from './identity';
import { buildCompanionFamilies, buildCompanionSnapshot } from './companionDashboards';
import { APPROVAL_SOURCES, buildApprovalInbox, resolveApprovalAction } from './companionApprovals';
import { shapeNotifications, shapeSearch, shapeTimeline } from './companionFeeds';
import { buildCompanionBriefing, resolveBriefingPeriod } from './companionBriefing';
import { CompanionGateway, type CompanionOpTable } from './gatewayServer';
import { companionGatewayService } from './gatewayService';
import { getCanonicalIndustrySnapshot } from '../industry/canonicalIndustryCatalog';

const log = createLogger('companion');

/**
 * Dispatch a secure IPC channel in-process (RBAC + Zod + the real handler),
 * bound by runtimeCore AFTER the handler registry exists. The companion write
 * path (approvals.act) uses this so it can never bypass the enterprise guards.
 */
export type CompanionDispatch = (channel: string, payload: unknown) => Promise<unknown>;

export interface InitCompanionDeps {
  /** The desktop has a signed-in session (the gateway refuses phone requests otherwise). */
  isSignedIn: () => boolean;
  /** Signed-in session email (the device is bound to it at pairing). */
  sessionEmail: () => string | null;
  /** Active organization display name, for the pairing QR + session hello. */
  orgName: () => string;
  /** The live enterprise module registry — the phone's dashboards read it in-process. */
  modules: EnterpriseModuleRegistry;
  /** The desktop's executive KPI snapshot (the same one the desktop Center renders). */
  executiveSnapshot: () => ExecutiveCenterSnapshot;
  /** Subscribe to platform events for realtime push to paired phones (M1-06b). */
  subscribe: (
    types: PlatformEventType[],
    handler: (event: PlatformEvent) => void,
  ) => { dispose: () => void };
  broadcast: IpcBroadcaster;
}

/** The small set of platform events pushed to a paired phone in realtime. */
const COMPANION_PUSH_EVENT_TYPES: PlatformEventType[] = [
  'enterprise.record.created',
  'enterprise.record.updated',
  'enterprise.record.status_changed',
  'enterprise.record.deleted',
  'enterprise.record.converted',
];

export interface CompanionSubsystem {
  handlers: SecureHandlerDef[];
  /** Bind the in-process secure dispatch (runtimeCore calls this once the registry exists). */
  bindDispatch: (dispatch: CompanionDispatch) => void;
  stop: () => Promise<void>;
}

export async function initCompanion(deps: InitCompanionDeps): Promise<CompanionSubsystem> {
  const store = companionDeviceStore();
  await store.load();
  const identity = await loadOrCreateIdentity();
  const desktopName = hostname() || 'NeuroPause Desktop';

  // Bound by runtimeCore after the secure handler registry is assembled; the
  // write path + feed reads refuse until it is set.
  let dispatch: CompanionDispatch | null = null;
  const requireDispatch = (): CompanionDispatch => {
    if (!dispatch) throw new Error('Companion gateway is not ready.');
    return dispatch;
  };

  // The authenticated op table. Each op returns a phone-shaped VIEW-MODEL over
  // real desktop state — never raw ERP CRUD. Later increments extend this table
  // (approvals + act in M1-05, timeline/search in M1-06); they never replace it.
  const ops: CompanionOpTable = {
    'session.hello': async (_params, ctx) => ({
      desktopName,
      orgName: deps.orgName(),
      user: deps.sessionEmail(),
      deviceId: ctx.device.id,
      protocolVersion: COMPANION_PROTOCOL_VERSION,
    }),

    // M1-04 — the executive KPI strip for the phone Home/Dashboard.
    'dashboard.snapshot': async () => buildCompanionSnapshot(deps.executiveSnapshot()),

    // M1-04 — the enterprise families the phone can drill into, with live counts.
    'dashboard.families': async () => buildCompanionFamilies(await deps.modules.summaries()),

    // M1-04 — one family's dashboard, built with the SAME shared model the desktop
    // renders, over the family's live records (read in-process, never duplicated).
    'dashboard.family': async (params, ctx) => {
      const group =
        typeof (params as { group?: unknown })?.group === 'string'
          ? (params as { group: string }).group
          : '';
      if (!group) throw new Error('A family group is required.');
      const summaries = await deps.modules.summaries();
      const groupSummaries = summaries.filter((s) => s.group === group);
      const recordsByModule = new Map<string, EnterpriseEntity[]>();
      for (const s of groupSummaries) {
        const m = deps.modules.get(s.id);
        if (!m) continue;
        await m.store.load();
        recordsByModule.set(s.id, m.store.list({ limit: 500 }));
      }
      return buildFamilyDashboard(group, groupSummaries, recordsByModule, ctx.now);
    },

    // IP-11 — the canonical Industry catalog for the executive phone view. Returns the SAME
    // read-only `industry:snapshot` DTO the desktop Industry Center renders (the Wave 9 vertical
    // packs + capability-evidence + readiness), sourced in-process from the existing accessor.
    // No new store, no per-tenant compute — a view-model over the catalog the platform already owns.
    'industry.snapshot': async () => getCanonicalIndustrySnapshot(),

    // M1-05 — the cross-module "waiting on you" approvals inbox.
    'approvals.list': async () => {
      const summaries = await deps.modules.summaries();
      const summariesById = new Map(summaries.map((s) => [s.id, s]));
      const recordsById = new Map<string, EnterpriseEntity[]>();
      for (const src of APPROVAL_SOURCES) {
        const m = deps.modules.get(src.moduleId);
        if (!m) continue;
        await m.store.load();
        recordsById.set(src.moduleId, m.store.list({ limit: 500 }));
      }
      return buildApprovalInbox(APPROVAL_SOURCES, summariesById, recordsById);
    },

    // M1-05 — approve/reject/comment. Routed through the SAME secure handler
    // pipeline as the desktop: RBAC, audit, and the modules' own guards
    // (budget/contract gates, reason-required) all apply and their refusals
    // surface here as thrown errors the gateway seals back to the phone.
    'approvals.act': async (params) => {
      const p = (params ?? {}) as {
        moduleId?: unknown;
        id?: unknown;
        action?: unknown;
        reason?: unknown;
      };
      const moduleId = typeof p.moduleId === 'string' ? p.moduleId : '';
      const id = typeof p.id === 'string' ? p.id : '';
      const action = typeof p.action === 'string' ? p.action : '';
      const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
      const resolved = resolveApprovalAction(moduleId, action);
      if (!moduleId || !id || !resolved) throw new Error('Unknown approval action.');
      if (!dispatch) throw new Error('Companion gateway is not ready to act.');
      // Reason/comment is a record field the module reads on decision — set it first.
      if (reason && resolved.reasonField) {
        await dispatch(IpcChannel.EnterpriseModuleUpdate, {
          moduleId,
          id,
          fields: { [resolved.reasonField]: reason },
        });
      }
      const result = await dispatch(IpcChannel.EnterpriseModuleAction, { moduleId, id, action });
      if (
        result &&
        typeof result === 'object' &&
        'ok' in result &&
        (result as { ok: unknown }).ok === false
      ) {
        throw new Error(String((result as { error?: unknown }).error ?? 'The action was refused.'));
      }
      return { ok: true };
    },

    // M1-06a — the enterprise Activity Timeline (cursor-paginated).
    'timeline.list': async (params) => {
      const p = (params ?? {}) as { cursor?: unknown; limit?: unknown };
      const payload: { cursor?: string; limit?: number } = {};
      if (typeof p.cursor === 'string') payload.cursor = p.cursor;
      if (typeof p.limit === 'number') payload.limit = p.limit;
      const page = (await requireDispatch()(
        IpcChannel.EnterpriseTimelineQuery,
        payload,
      )) as EnterpriseTimelinePage;
      return shapeTimeline(page);
    },

    // M1-06a — enterprise search (UDM / graph / memory / timeline; not record bodies).
    'search.query': async (params) => {
      const text =
        typeof (params as { text?: unknown })?.text === 'string'
          ? (params as { text: string }).text.trim()
          : '';
      if (!text) throw new Error('A search query is required.');
      const result = (await requireDispatch()(IpcChannel.EnterpriseSearch, {
        text,
      })) as EnterpriseSearchResult;
      return shapeSearch(result);
    },

    // M1-06a — the notification inbox.
    'notifications.list': async (params) => {
      const payload: { limit?: number } = {};
      if (typeof (params as { limit?: unknown })?.limit === 'number') {
        payload.limit = (params as { limit: number }).limit;
      }
      const page = (await requireDispatch()(
        IpcChannel.NotificationsList,
        payload,
      )) as NotificationInboxPage;
      return shapeNotifications(page);
    },

    // M1-07 — a composed morning/evening executive brief (real KPIs + approvals + families).
    'briefing.get': async (params, ctx) => {
      const req = (params ?? {}) as { period?: unknown };
      const period =
        req.period === 'morning' || req.period === 'evening'
          ? req.period
          : resolveBriefingPeriod(ctx.now);
      const summaries = await deps.modules.summaries();
      const summariesById = new Map(summaries.map((s) => [s.id, s]));
      const recordsById = new Map<string, EnterpriseEntity[]>();
      for (const src of APPROVAL_SOURCES) {
        const m = deps.modules.get(src.moduleId);
        if (!m) continue;
        await m.store.load();
        recordsById.set(src.moduleId, m.store.list({ limit: 500 }));
      }
      return buildCompanionBriefing({
        period,
        nowIso: ctx.now,
        snapshot: buildCompanionSnapshot(deps.executiveSnapshot()),
        approvals: buildApprovalInbox(APPROVAL_SOURCES, summariesById, recordsById),
        families: buildCompanionFamilies(summaries),
      });
    },
  };

  const gateway = identity
    ? new CompanionGateway({
        identity,
        devices: store,
        isSignedIn: deps.isSignedIn,
        currentMember: deps.sessionEmail,
        desktopName: () => desktopName,
        orgName: deps.orgName,
        ops,
      })
    : null;

  if (!identity) {
    log.warn('Companion identity unavailable (OS keychain); gateway will stay disabled');
  }

  const announce = (): void => {
    deps.broadcast(IpcChannel.CompanionEventBroadcast, {
      kind: 'status',
      enabled: store.isEnabled(),
      running: gateway?.isRunning() ?? false,
      deviceCount: store.activeCount(),
      at: new Date().toISOString(),
    });
  };

  let eventSub: { dispose: () => void } | null = null;
  const controller = {
    async startIfEnabled(): Promise<void> {
      if (!gateway || !store.isEnabled() || gateway.isRunning()) return;
      try {
        await gateway.start(store.getPort());
        // M1-06b — forward the small enterprise-record event set to paired phones.
        eventSub = deps.subscribe(COMPANION_PUSH_EVENT_TYPES, (e) => gateway.broadcastEvent(e));
        announce();
      } catch (err) {
        log.error('Companion gateway failed to start', { error: String(err) });
      }
    },
    async stop(): Promise<void> {
      eventSub?.dispose();
      eventSub = null;
      if (gateway?.isRunning()) {
        await gateway.stop();
        announce();
      }
    },
  };
  companionGatewayService.bind(controller);

  const status = (): CompanionStatusDto => {
    const addr = gateway?.address() ?? { host: null, port: null };
    return {
      enabled: store.isEnabled(),
      running: gateway?.isRunning() ?? false,
      host: addr.host,
      port: addr.port,
      deviceCount: store.activeCount(),
      signedIn: deps.isSignedIn(),
      protocolVersion: COMPANION_PROTOCOL_VERSION,
    };
  };

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.CompanionStatus,
      schema: EmptyRequest,
      handler: () => status(),
    },
    {
      channel: IpcChannel.CompanionDevices,
      schema: EmptyRequest,
      handler: () => store.list().map(toCompanionDeviceDto),
    },
    {
      channel: IpcChannel.CompanionEnable,
      schema: CompanionEnableRequest,
      audit: true,
      handler: async (p) => {
        const { enabled } = p as CompanionEnableRequest;
        await store.setEnabled(enabled);
        if (enabled) await controller.startIfEnabled();
        else await controller.stop();
        announce();
        return status();
      },
    },
    {
      channel: IpcChannel.CompanionRevoke,
      schema: CompanionRevokeRequest,
      audit: true,
      handler: async (p) => {
        const ok = await store.revoke((p as CompanionRevokeRequest).deviceId);
        if (ok) announce();
        return { ok };
      },
    },
    {
      channel: IpcChannel.CompanionPairingQr,
      schema: EmptyRequest,
      audit: true,
      handler: () => {
        if (!gateway || !gateway.isRunning()) {
          throw new Error('Enable the companion gateway before pairing a device.');
        }
        return gateway.mintPairingQr(store.getPort());
      },
    },
  ];

  // Auto-start if the user had it enabled in a previous session (service
  // manager also calls start(), but doing it here keeps status truthful before
  // the manager's pass).
  await controller.startIfEnabled();

  log.info('Companion subsystem ready', {
    enabled: store.isEnabled(),
    devices: store.activeCount(),
    identity: Boolean(identity),
  });

  return {
    handlers,
    bindDispatch: (fn: CompanionDispatch) => {
      dispatch = fn;
    },
    stop: () => controller.stop(),
  };
}
