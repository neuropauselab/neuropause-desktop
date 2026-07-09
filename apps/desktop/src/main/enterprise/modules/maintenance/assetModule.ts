/**
 * Maintenance → Assets — the registry of maintainable assets (optionally linked to a
 * Manufacturing machine). The `summarize` hook explains the deterministic asset
 * health; the AI never computes it. Master data — no stock effect.
 */
import type {
  Asset,
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
} from '@neuropause/shared';
import {
  ASSETS_MODULE_ID,
  ASSET_KIND,
  assetFromRecord,
  assetSummaryFallback,
  calculateAssetHealth,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const ASSET_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: ASSETS_MODULE_ID,
  title: 'Assets',
  singular: 'Asset',
  plural: 'Assets',
  icon: 'box',
  description: 'Maintainable assets, optionally linked to a machine.',
  group: 'Maintenance',
  titleField: 'assetTag',
  permissions: { read: 'maintenance:read', write: 'maintenance:manage' },
  fields: [
    { key: 'assetTag', label: 'Asset Tag', type: 'text', required: true, placeholder: 'AST-0001' },
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'CNC Mill 3' },
    { key: 'category', label: 'Category', type: 'text', column: false },
    { key: 'location', label: 'Location', type: 'text', column: false },
    { key: 'machine', label: 'Linked Machine', type: 'text', column: false, help: 'Machine name or code (Manufacturing)' },
    {
      key: 'criticality',
      label: 'Criticality',
      type: 'select',
      required: true,
      default: 'medium',
      badge: true,
      filterable: true,
      options: [
        { value: 'low', label: 'Low', tone: 'neutral' },
        { value: 'medium', label: 'Medium', tone: 'blue' },
        { value: 'high', label: 'High', tone: 'orange' },
        { value: 'critical', label: 'Critical', tone: 'orange' },
      ],
    },
    { key: 'purchaseCost', label: 'Purchase Cost', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'purchaseDate', label: 'Purchase Date', type: 'date', column: false, format: 'date' },
    { key: 'breakdownCount', label: 'Breakdowns', type: 'number', min: 0 },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'operational',
      badge: true,
      filterable: true,
      options: [
        { value: 'operational', label: 'Operational', tone: 'green' },
        { value: 'maintenance', label: 'Maintenance', tone: 'blue' },
        { value: 'retired', label: 'Retired', tone: 'neutral' },
      ],
    },
  ],
};

export interface AssetAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type AssetAiRunner = (asset: Asset) => Promise<AssetAiNarrative | null>;

export function createAssetModule(storePath: string, aiRunner?: AssetAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, ASSETS_MODULE_ID, ASSET_KIND);
  return defineEnterpriseModule({
    descriptor: ASSET_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const asset = assetFromRecord(record);
        const health = calculateAssetHealth(asset);
        const ai = aiRunner ? await aiRunner(asset).catch(() => null) : null;
        const fallback = assetSummaryFallback(asset, health);
        return {
          moduleId: ASSETS_MODULE_ID,
          recordId: record.id,
          headline: `${asset.name} · ${asset.assetTag} · ${asset.status} · ${asset.criticality}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: health.level,
          riskReason: health.reason,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
    },
  });
}
