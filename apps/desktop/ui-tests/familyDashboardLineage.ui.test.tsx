/**
 * NP-011 / FG-11 — the tile law on the Business family band: the dashboard's
 * numbers NAME the register they were computed over, via the ONE shared
 * lineage rule (`deriveSourceLineage`, moved to @neuropause/shared under the
 * FG-11 gate). The pin: records with mixed provenance render the exact
 * sentence — imported files named with the §2 trust label, hand entry counted
 * as "entered in app".
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { BusinessFamilyGroup } from '@renderer/business/businessModel';
import { FamilyDashboard } from '@renderer/business/FamilyDashboard';
import { IpcChannel } from '@neuropause/shared';
import { clearRoutes, route } from './setup';

// jsdom has no ResizeObserver; recharts' ResponsiveContainer (the ChartKit
// widgets behind the lineage line) requires one. A no-op stands in — this test
// pins the lineage SENTENCE, not chart geometry.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
beforeEach(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver;
  clearRoutes();
});
afterEach(() => cleanup());

const MODULE = {
  id: 'finance',
  title: 'Invoices',
  singular: 'Invoice',
  plural: 'Invoices',
  icon: 'doc',
  description: 'test',
  titleField: 'number',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [{ key: 'number', label: 'Invoice #', type: 'text', required: true }],
  recordCount: 2,
  activeCount: 2,
  aiSummary: false,
  actions: [],
};

const FAMILY = {
  meta: { group: 'Finance', label: 'Finance', icon: 'doc', blurb: 'test' },
  modules: [MODULE],
  recordCount: 2,
  activeCount: 2,
  hasAi: false,
} as unknown as BusinessFamilyGroup;

const record = (id: string, metadata: Record<string, unknown>) => ({
  id,
  title: id,
  fields: { number: id },
  tags: [],
  metadata,
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  createdBy: 't',
  updatedBy: 't',
});

describe('FamilyDashboard lineage line (FG-11)', () => {
  it('names the register — imported files with the trust label, hand entry counted', async () => {
    route(IpcChannel.EnterpriseModuleList, () => [
      record('INV-1', { importSourceFile: 'zoho.csv', importSourceTrust: 'unverified-source' }),
      record('INV-2', {}),
    ]);
    render(<FamilyDashboard family={FAMILY} />);
    expect(
      await screen.findByText(
        'Computed over 2 records — 1 imported from zoho.csv (unverified-source), 1 entered in app.',
      ),
    ).toBeTruthy();
  });
});
