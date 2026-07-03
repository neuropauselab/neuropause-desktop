/**
 * Enterprise Ecosystem types (Phase 8 · Stage 2). The org-facing network built on
 * the Stage 1 marketplace: installing/sharing/updating listings, the organization
 * exchange of packs, the partner directory, and ecosystem-wide analytics. The
 * marketplace listing/version/kind types live in `ecosystem.ts`; this file adds
 * the consumption + network layer.
 */
import type { ListingKind } from './ecosystem';

/* ════════════════════════════ Installations ═══════════════════════════════ */

export type InstallStatus = 'installed' | 'update_available' | 'disabled';

export interface Installation {
  id: string;
  orgId: string;
  listingId: string;
  listingName: string;
  kind: ListingKind;
  installedVersionId: string;
  installedVersion: string;
  status: InstallStatus;
  installedAt: string;
  updatedAt: string;
}

export interface InstallSummary {
  totalInstalled: number;
  updatesAvailable: number;
  byKind: Record<string, number>;
}

/** Connector certification tiers shown in the Connector Marketplace. */
export type ConnectorTier = 'community' | 'enterprise' | 'certified';

/** Enterprise template families shown in the Template Marketplace. */
export type TemplateCategory = 'workflow' | 'governance_policy' | 'approval_chain' | 'dashboard' | 'industry';

export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = ['workflow', 'governance_policy', 'approval_chain', 'dashboard', 'industry'];

/* ════════════════════════════ Organization Exchange ═══════════════════════ */

export type PackKind = 'knowledge' | 'ai_worker' | 'automation' | 'connector';

export const PACK_KINDS: readonly PackKind[] = ['knowledge', 'ai_worker', 'automation', 'connector'];

export interface PackItem {
  kind: string;
  name: string;
  detail: string;
}

export interface ExchangePack {
  id: string;
  name: string;
  summary: string;
  kind: PackKind;
  publisherOrg: string;
  publisherOrgId: string;
  /** Published by the local organization (vs shared in from the network). */
  isLocal: boolean;
  items: PackItem[];
  installs: number;
  /** Imported into the local organization. */
  installed: boolean;
  createdAt: string;
}

export interface ExchangeStats {
  total: number;
  published: number;
  imported: number;
  byKind: Record<string, number>;
}

/* ════════════════════════════ Partner Platform ════════════════════════════ */

export type PartnerType = 'technology' | 'consulting' | 'system_integrator' | 'msp';

export const PARTNER_TYPES: readonly PartnerType[] = ['technology', 'consulting', 'system_integrator', 'msp'];

export type PartnerTier = 'registered' | 'select' | 'premier';

export interface Partner {
  id: string;
  name: string;
  type: PartnerType;
  tier: PartnerTier;
  description: string;
  website: string;
  regions: string[];
  specializations: string[];
  listings: number;
  certified: boolean;
  joinedAt: string;
}

export interface PartnerStats {
  total: number;
  byType: Record<string, number>;
  premier: number;
  certified: number;
}

/* ════════════════════════════ Ecosystem Analytics ═════════════════════════ */

export interface GrowthPoint {
  period: string;
  listings: number;
  installs: number;
}

export interface EcosystemRevenue {
  gross: number;
  platformFees: number;
  net: number;
  currency: string;
}

export interface EcosystemUsage {
  requests30d: number;
  computeUnits30d: number;
  p95LatencyMs: number;
}

export type EcoHealthStatus = 'good' | 'watch' | 'risk';

export interface EcosystemHealthSignal {
  label: string;
  status: EcoHealthStatus;
  detail: string;
}

export interface EcosystemHealth {
  score: number;
  label: string;
  signals: EcosystemHealthSignal[];
}

export interface EcosystemAnalytics {
  generatedAt: string;
  totalListings: number;
  publishedListings: number;
  certifiedListings: number;
  totalInstalls: number;
  activeDevelopers: number;
  activeOrganizations: number;
  partners: number;
  packs: number;
  downloads30d: number;
  revenue: EcosystemRevenue;
  usage: EcosystemUsage;
  growth: GrowthPoint[];
  byKind: Record<string, number>;
  topListings: { name: string; installs: number; kind: string }[];
  health: EcosystemHealth;
}
