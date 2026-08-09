/**
 * Medical Device Pack — the wire shapes exchanged over `md:*` IPC.
 *
 * Product CRUD is NOT here: products are an Enterprise Module, so create,
 * update, status change and delete already have a generic, audited, RBAC-gated
 * channel set (`enterprise:module.*`). Duplicating them would be a second CRUD
 * system for one entity, which is the thing the charter forbids. What IS here
 * is everything the generic surface cannot express: field-scoped product
 * search, and every lot operation, because a lot's quantity and lifecycle are
 * invariants a generic record write would step straight over.
 */
import type { IndustryPackManifest, ResolvedTaxonomy } from './industryPack';
import type { MedicalDeviceProduct } from './medicalDevice';
import type { LotCenterCounts, LotCenterView, LotStatus, MedicalDeviceLot } from './medicalDeviceLot';
import type { LotTraceContext, TraceLine, TraceNodeRef, TraceResult } from './medicalDeviceTrace';

/** The pack, resolved for the active tenant. */
export interface MedicalDevicePackView {
  manifest: IndustryPackManifest;
  taxonomies: readonly ResolvedTaxonomy[];
  tenantId: string;
  counts: { products: number; lots: number; traceEdges: number };
}

/* ── products ──────────────────────────────────────────────────────────────── */

export interface DeviceProductListItem extends MedicalDeviceProduct {
  /** Lots currently recorded against this product, in the active tenant. */
  lotCount: number;
}

export interface DeviceProductDetail {
  product: MedicalDeviceProduct;
  lots: readonly MedicalDeviceLot[];
  /**
   * The record's own change history, from the enterprise audit trail. Empty is
   * an honest answer for a product created before auditing covered it.
   */
  history: readonly DeviceAuditEntry[];
}

export interface DeviceAuditEntry {
  at: string;
  actor: string | null;
  action: string;
  summary: string;
}

/* ── lots ──────────────────────────────────────────────────────────────────── */

/** A lot with the values that are DERIVED rather than stored. */
export interface DeviceLotListItem extends MedicalDeviceLot {
  remaining: number;
  /** True when the expiry date has passed, computed at read. */
  expired: boolean;
  productName: string;
}

export interface DeviceLotPage {
  view: LotCenterView;
  lots: readonly DeviceLotListItem[];
  counts: LotCenterCounts;
  /** Total before the limit was applied, so the UI never implies it has all rows. */
  total: number;
}

export interface DeviceLotDetail {
  lot: DeviceLotListItem;
  product: MedicalDeviceProduct | null;
  context: LotTraceContext;
  /** Transitions legal from the lot's current state, with their labels. */
  allowedTransitions: readonly { status: LotStatus; label: string }[];
  history: readonly DeviceAuditEntry[];
  /**
   * Surfaces this build does not have. Rendered verbatim on the lot detail so a
   * user reads "Quality records: not yet configured" instead of an empty panel
   * that looks like a lot with no quality history.
   */
  notConfigured: readonly { section: string; reason: string }[];
}

/** Every lot write answers with this shape. */
export interface DeviceLotMutationResult {
  ok: boolean;
  /** Present on failure — always a sentence naming what to do instead. */
  error?: string;
  lot?: DeviceLotListItem;
  /** Lots created by the operation (split children). */
  created?: readonly DeviceLotListItem[];
}

/* ── traceability ──────────────────────────────────────────────────────────── */

export interface DeviceTraceView {
  result: TraceResult;
  lines: readonly TraceLine[];
  /** Root, resolved to a label the user recognizes. */
  root: TraceNodeRef;
  /** Set when the walk hit its depth or node budget. */
  truncated: boolean;
  /** Plain-language statement of what was and was not searched. */
  scopeNote: string;
}
