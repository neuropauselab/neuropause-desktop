/**
 * Medical Device Pack — IPC surface and composition.
 *
 * Product CRUD is absent from this file on purpose: products are an Enterprise
 * Module, so create / update / status / delete already have a generic, audited,
 * RBAC-gated channel set, and a second one would be a second CRUD system for
 * one entity. What is here is what the generic surface cannot express — field-
 * scoped product search, and every lot operation, because a lot's quantity and
 * lifecycle are invariants a generic record write would walk straight past.
 *
 * Every handler is registered through the existing secure bridge, so it
 * inherits sender-trust, the auth gate, Zod validation, the timeout and the
 * call audit. The per-channel `permission` below is the RBAC declaration; the
 * services assert the same scope again at the point of the write, because a
 * service is also reachable from the import path, which is not an IPC call.
 */
import type {
  DeviceAuditEntry,
  DeviceLotDetail,
  DeviceLotMutationResult,
  DeviceLotPage,
  DeviceProductDetail,
  DeviceProductListItem,
  DeviceTraceView,
  EnterpriseAuditEntry,
  EnterprisePermission,
  LotCenterView,
  MedicalDevicePackView,
  MedicalDeviceLotConsumeRequest as TConsume,
  MedicalDeviceLotCreateRequest as TCreate,
  MedicalDeviceLotGetRequest as TLotGet,
  MedicalDeviceLotListRequest as TLotList,
  MedicalDeviceLotMergeRequest as TMerge,
  MedicalDeviceLotMoveRequest as TMove,
  MedicalDeviceLotShipRequest as TShip,
  MedicalDeviceLotSplitRequest as TSplit,
  MedicalDeviceLotTransitionRequest as TTransition,
  MedicalDeviceProductGetRequest as TProductGet,
  MedicalDeviceProductSearchRequest as TProductSearch,
  MedicalDeviceTraceRequest as TTrace,
} from '@neuropause/shared';
import {
  EmptyRequest,
  IpcChannel,
  LOT_CENTER_VIEWS,
  LOT_STATUS_LABELS,
  LOT_STATUS_TRANSITIONS,
  MEDICAL_DEVICE_PACK_ID,
  MEDICAL_DEVICE_PACK_MANIFEST,
  MedicalDeviceLotConsumeRequest,
  MedicalDeviceLotCreateRequest,
  MedicalDeviceLotGetRequest,
  MedicalDeviceLotListRequest,
  MedicalDeviceLotMergeRequest,
  MedicalDeviceLotMoveRequest,
  MedicalDeviceLotShipRequest,
  MedicalDeviceLotSplitRequest,
  MedicalDeviceLotTransitionRequest,
  MedicalDeviceProductGetRequest,
  MedicalDeviceProductSearchRequest,
  MedicalDeviceTraceRequest,
  countLotViews,
  deviceProductFromRecord,
  lotContext,
  lotInView,
  matchesLotSearch,
  matchesProductSearch,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import type { EnterpriseModule } from '../enterprise/framework';
import { industryPackRegistry } from '../industryPacks/registry';
import type { TraceEdgeStore } from './traceStore';
import type { LotService } from './lotService';
import type { TraceService } from './traceService';

export { createDeviceProductModule } from './deviceProductModule';
export { createDeviceLotModule, LOT_DIRECT_WRITE_REFUSAL } from './deviceLotModule';
export { TraceEdgeStore } from './traceStore';
export { LotService } from './lotService';
export { TraceService } from './traceService';

/**
 * Surfaces this stage does not have.
 *
 * Rendered verbatim on the lot detail. The alternative — an empty "Quality"
 * panel — reads as "this lot has no quality history", which is a different and
 * much more dangerous statement than "this build has no quality module".
 */
export const LOT_NOT_CONFIGURED: readonly { section: string; reason: string }[] = [
  {
    section: 'Quality status',
    reason:
      'Not yet configured. The Quality Center (inspections, non-conformances, CAPA) is not part of this build, so no quality record exists for any lot.',
  },
  {
    section: 'Documents',
    reason:
      'Not yet configured. Document control is not part of this build; no batch record or certificate is attached to any lot.',
  },
];

export interface MedicalDeviceDeps {
  products: EnterpriseModule;
  lots: EnterpriseModule;
  edges: TraceEdgeStore;
  lotService: LotService;
  traceService: TraceService;
  tenantId: () => string;
  authorize: (permission: EnterprisePermission) => void;
  /** Enterprise audit entries, newest first — the source of record history. */
  auditEntries: (limit: number) => EnterpriseAuditEntry[];
}

/** Register the pack's manifest. Idempotent across hot reloads in dev. */
export function registerMedicalDevicePack(): void {
  if (!industryPackRegistry.get(MEDICAL_DEVICE_PACK_ID)) {
    industryPackRegistry.register(MEDICAL_DEVICE_PACK_MANIFEST);
  }
}

/** A record's own change history, taken from the enterprise audit trail. */
function historyFor(deps: MedicalDeviceDeps, recordId: string): DeviceAuditEntry[] {
  return deps
    .auditEntries(2_000)
    .filter((e) => e.target === recordId)
    .map((e) => ({ at: e.at, actor: e.actor ?? null, action: e.action, summary: e.summary }));
}

export function buildMedicalDeviceHandlers(deps: MedicalDeviceDeps): SecureHandlerDef[] {
  const tenant = (): string => deps.tenantId();

  const productsInTenant = async (): Promise<ReturnType<typeof deviceProductFromRecord>[]> => {
    await deps.products.store.load();
    return deps.products.store
      .list()
      .filter((r) => String(r.metadata?.tenantId ?? '') === tenant())
      .map(deviceProductFromRecord);
  };

  return [
    {
      channel: IpcChannel.MedicalDevicePack,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'medicalDevice:product.read',
      handler: async (): Promise<MedicalDevicePackView> => {
        await deps.products.store.load();
        await deps.lots.store.load();
        const tenantId = tenant();
        return {
          manifest: MEDICAL_DEVICE_PACK_MANIFEST,
          taxonomies: industryPackRegistry.taxonomiesFor(tenantId, MEDICAL_DEVICE_PACK_ID),
          tenantId,
          counts: {
            products: (await productsInTenant()).length,
            lots: (await deps.lotService.allLots()).length,
            traceEdges: deps.edges.count(tenantId),
          },
        };
      },
    },
    {
      channel: IpcChannel.MedicalDeviceProductSearch,
      schema: MedicalDeviceProductSearchRequest,
      requireAuth: true,
      permission: 'medicalDevice:product.read',
      handler: async (payload): Promise<DeviceProductListItem[]> => {
        const r = payload as TProductSearch;
        deps.authorize('medicalDevice:product.read');
        const products = await productsInTenant();
        const lots = await deps.lotService.allLots();
        const lotCounts = new Map<string, number>();
        for (const lot of lots) lotCounts.set(lot.productId, (lotCounts.get(lot.productId) ?? 0) + 1);
        const filtered = products.filter((p) => {
          if (r.query && !matchesProductSearch(p, r.query)) return false;
          if (r.family && p.productFamily !== r.family) return false;
          if (r.category && p.category !== r.category) return false;
          if (r.material && p.material !== r.material) return false;
          if (r.status && p.status !== r.status) return false;
          return true;
        });
        filtered.sort((a, b) => a.productCode.localeCompare(b.productCode));
        return filtered
          .slice(0, r.limit ?? 200)
          .map((p) => ({ ...p, lotCount: lotCounts.get(p.id) ?? 0 }));
      },
    },
    {
      channel: IpcChannel.MedicalDeviceProductGet,
      schema: MedicalDeviceProductGetRequest,
      requireAuth: true,
      permission: 'medicalDevice:product.read',
      handler: async (payload): Promise<DeviceProductDetail | null> => {
        const r = payload as TProductGet;
        deps.authorize('medicalDevice:product.read');
        await deps.products.store.load();
        const record = deps.products.store.get(r.productId);
        if (!record || record.status === 'deleted') return null;
        if (String(record.metadata?.tenantId ?? '') !== tenant()) return null;
        const product = deviceProductFromRecord(record);
        const lots = (await deps.lotService.allLots()).filter((l) => l.productId === product.id);
        return { product, lots, history: historyFor(deps, product.id) };
      },
    },
    {
      channel: IpcChannel.MedicalDeviceLotList,
      schema: MedicalDeviceLotListRequest,
      requireAuth: true,
      permission: 'medicalDevice:lot.read',
      handler: async (payload): Promise<DeviceLotPage> => {
        const r = payload as TLotList;
        deps.authorize('medicalDevice:lot.read');
        const view: LotCenterView = LOT_CENTER_VIEWS.includes(r.view as LotCenterView)
          ? (r.view as LotCenterView)
          : 'all';
        const all = await deps.lotService.allLots();
        const now = new Date().toISOString();
        const counts = countLotViews(all, now);
        let matched = all.filter((l) => lotInView(l, view, now));
        if (r.productId) matched = matched.filter((l) => l.productId === r.productId);
        if (r.search) matched = matched.filter((l) => matchesLotSearch(l, r.search as string));
        matched.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        const total = matched.length;
        const page = matched.slice(0, r.limit ?? 200);
        return {
          view,
          counts,
          total,
          lots: await Promise.all(page.map((l) => deps.lotService.decorate(l))),
        };
      },
    },
    {
      channel: IpcChannel.MedicalDeviceLotGet,
      schema: MedicalDeviceLotGetRequest,
      requireAuth: true,
      permission: 'medicalDevice:lot.read',
      handler: async (payload): Promise<DeviceLotDetail | null> => {
        const r = payload as TLotGet;
        deps.authorize('medicalDevice:lot.read');
        const lot = await deps.lotService.lotById(r.lotId);
        if (!lot) return null;
        await deps.products.store.load();
        const productRecord = lot.productId ? deps.products.store.get(lot.productId) : null;
        return {
          lot: await deps.lotService.decorate(lot),
          product: productRecord ? deviceProductFromRecord(productRecord) : null,
          context: lotContext(deps.edges.around(tenant(), { type: 'lot', id: lot.id }), lot.id),
          allowedTransitions: LOT_STATUS_TRANSITIONS[lot.status].map((status) => ({
            status,
            label: LOT_STATUS_LABELS[status],
          })),
          history: historyFor(deps, lot.id),
          notConfigured: LOT_NOT_CONFIGURED,
        };
      },
    },
    {
      channel: IpcChannel.MedicalDeviceLotCreate,
      schema: MedicalDeviceLotCreateRequest,
      requireAuth: true,
      permission: 'medicalDevice:lot.write',
      audit: true,
      handler: async (payload): Promise<DeviceLotMutationResult> =>
        deps.lotService.createLot(payload as TCreate),
    },
    {
      channel: IpcChannel.MedicalDeviceLotTransition,
      schema: MedicalDeviceLotTransitionRequest,
      requireAuth: true,
      permission: 'medicalDevice:lot.write',
      audit: true,
      handler: async (payload): Promise<DeviceLotMutationResult> => {
        const r = payload as TTransition;
        return deps.lotService.transition(r.lotId, r.status, r.reason);
      },
    },
    {
      channel: IpcChannel.MedicalDeviceLotSplit,
      schema: MedicalDeviceLotSplitRequest,
      requireAuth: true,
      permission: 'medicalDevice:lot.write',
      audit: true,
      handler: async (payload): Promise<DeviceLotMutationResult> => {
        const r = payload as TSplit;
        return deps.lotService.split(r.lotId, r.parts);
      },
    },
    {
      channel: IpcChannel.MedicalDeviceLotMerge,
      schema: MedicalDeviceLotMergeRequest,
      requireAuth: true,
      permission: 'medicalDevice:lot.write',
      audit: true,
      handler: async (payload): Promise<DeviceLotMutationResult> =>
        deps.lotService.merge((payload as TMerge).lotIds),
    },
    {
      channel: IpcChannel.MedicalDeviceLotConsume,
      schema: MedicalDeviceLotConsumeRequest,
      requireAuth: true,
      permission: 'medicalDevice:lot.write',
      audit: true,
      handler: async (payload): Promise<DeviceLotMutationResult> =>
        deps.lotService.consume(payload as TConsume),
    },
    {
      channel: IpcChannel.MedicalDeviceLotMove,
      schema: MedicalDeviceLotMoveRequest,
      requireAuth: true,
      permission: 'medicalDevice:lot.write',
      audit: true,
      handler: async (payload): Promise<DeviceLotMutationResult> => {
        const r = payload as TMove;
        return deps.lotService.moveToWarehouse(r.lotId, r.warehouseId);
      },
    },
    {
      channel: IpcChannel.MedicalDeviceLotShip,
      schema: MedicalDeviceLotShipRequest,
      requireAuth: true,
      permission: 'medicalDevice:lot.write',
      audit: true,
      handler: async (payload): Promise<DeviceLotMutationResult> =>
        deps.lotService.recordShipment(payload as TShip),
    },
    {
      channel: IpcChannel.MedicalDeviceTraceForward,
      schema: MedicalDeviceTraceRequest,
      requireAuth: true,
      permission: 'medicalDevice:traceability.read',
      handler: async (payload): Promise<DeviceTraceView> => {
        const r = payload as TTrace;
        return deps.traceService.forward(r.nodeType, r.nodeId, r.maxDepth);
      },
    },
    {
      channel: IpcChannel.MedicalDeviceTraceBackward,
      schema: MedicalDeviceTraceRequest,
      requireAuth: true,
      permission: 'medicalDevice:traceability.read',
      handler: async (payload): Promise<DeviceTraceView> => {
        const r = payload as TTrace;
        return deps.traceService.backward(r.nodeType, r.nodeId, r.maxDepth);
      },
    },
  ];
}
