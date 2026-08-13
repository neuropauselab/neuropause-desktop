/**
 * IP-11 — pure tests for the Industry view-model adapters.
 */
import { describe, expect, it } from 'vitest';
import type { IndustryCatalogSnapshot } from '@neuropause/shared';
import { colors } from '../theme/tokens';
import {
  areaBars,
  evidenceColor,
  evidenceLabel,
  packBars,
  packSize,
  readinessSlices,
} from './industryModel';

const snapshot: IndustryCatalogSnapshot = {
  version: '9.0.0',
  source: 'catalog',
  industries: [
    {
      key: 'fin',
      name: 'Finance',
      reusesDomains: ['finance'],
      counts: {
        objects: 2,
        workflows: 1,
        kpis: 1,
        compliancePacks: 0,
        connectors: 0,
        aiSkills: 0,
        documentTemplates: 0,
      },
      approvalWorkflows: 1,
    },
    {
      key: 'health',
      name: 'Healthcare',
      reusesDomains: ['crm', 'compliance'],
      counts: {
        objects: 5,
        workflows: 3,
        kpis: 2,
        compliancePacks: 2,
        connectors: 1,
        aiSkills: 1,
        documentTemplates: 1,
      },
      approvalWorkflows: 2,
    },
  ],
  capabilities: [
    {
      area: 'Data',
      items: [
        { capability: 'Objects', area: 'Data', level: 'live-verified', note: '' },
        { capability: 'Sync', area: 'Data', level: 'adapter-verified', note: '' },
      ],
    },
    {
      area: 'AI',
      items: [{ capability: 'Copilot', area: 'AI', level: 'business-data-pending', note: '' }],
    },
  ],
  readiness: {
    total: 10,
    liveVerified: 6,
    adapterVerified: 2,
    businessDataPending: 2,
    regulatedExternal: 0,
    liveVerifiedPct: 60,
  },
};

describe('industryModel', () => {
  it('sums a pack size across every counted area', () => {
    expect(packSize(snapshot.industries[0].counts)).toBe(4);
    expect(packSize(snapshot.industries[1].counts)).toBe(15);
  });

  it('ranks packs by total capabilities, largest first, and caps', () => {
    expect(packBars(snapshot)).toEqual([
      { label: 'Healthcare', value: 15 },
      { label: 'Finance', value: 4 },
    ]);
    expect(packBars(snapshot, 1)).toEqual([{ label: 'Healthcare', value: 15 }]);
  });

  it('maps capability-evidence areas to item-count bars', () => {
    expect(areaBars(snapshot)).toEqual([
      { label: 'Data', value: 2 },
      { label: 'AI', value: 1 },
    ]);
  });

  it('builds readiness donut slices and drops empty evidence levels', () => {
    expect(readinessSlices(snapshot)).toEqual([
      { name: 'Live-verified', value: 6 },
      { name: 'Adapter-verified', value: 2 },
      { name: 'Data pending', value: 2 },
    ]);
  });

  it('labels the honest evidence levels and passes unknown through', () => {
    expect(evidenceLabel('live-verified')).toBe('Live-verified');
    expect(evidenceLabel('regulated-external')).toBe('External');
    expect(evidenceLabel('mystery')).toBe('mystery');
  });

  it('colours evidence levels from the shared tokens, muted when unknown', () => {
    expect(evidenceColor('live-verified')).toBe(colors.bands.healthy);
    expect(evidenceColor('business-data-pending')).toBe(colors.bands.watch);
    expect(evidenceColor('mystery')).toBe(colors.faint);
  });
});
