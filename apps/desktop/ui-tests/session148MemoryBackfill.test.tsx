/**
 * S148 — the governed semantic-index BACKFILL goes live at the renderer (FG-S148-MEMORY-BACKFILL).
 *
 * `memory:backfill` (IpcChannel.MemoryBackfill) was fully governed in main — RBAC `operations:manage`,
 * org resolved server-side via `activeMemoryViewer()`, gated by the `memoryMaySync` egress predicate
 * (personal/system memories never leave the device), embedding this tenant's memories into its cloud
 * vector namespace and returning a MemoryBackfillSummary — but had NO renderer path and no typed
 * response entry. S148 adds the one authorized frozen IpcResponseMap line, the typed
 * `ipc.memory.backfill` helper, and a "Rebuild semantic index" action on MemoryView.
 *
 * These tests prove renderer reachability + truthful state: the button dispatches `memory:backfill`
 * with an EMPTY payload (no renderer-supplied tenant/org — server-resolved), a success summary renders
 * an honest embedded/total line, a no-active-org run reads as LOCAL (not a failure), and a governed
 * refusal (RBAC/egress denial → thrown IPC error) renders a truthful message, never a fake success.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { MemoryView } from '@renderer/views/MemoryView';

const counts = (total: number) => ({ total, byKind: {}, byOrigin: {}, lastBuiltAt: null });
const summary = (over: Partial<{ orgId: string | null; total: number; processed: number; embedded: number; skipped: number; failed: number; batches: number; skippedReason: 'no_active_org' }>) =>
  ({ orgId: 'org-1', total: 0, processed: 0, embedded: 0, skipped: 0, failed: 0, batches: 0, ...over });

beforeEach(() => {
  cleanup();
  clearRoutes();
  route(IpcChannel.MemorySemanticRecall, () => ({ hits: [] }));
  route(IpcChannel.MemoryRecall, () => ({ hits: [] }));
  route(IpcChannel.MemoryCounts, () => counts(4));
});
afterEach(() => cleanup());

describe('S148 · memory semantic backfill renderer reachability', () => {
  it('dispatches memory:backfill with an EMPTY payload and reports embedded/total truthfully', async () => {
    let sawPayload: Record<string, unknown> | undefined;
    route(IpcChannel.MemoryBackfill, (p) => {
      sawPayload = p as Record<string, unknown>;
      return summary({ total: 4, processed: 4, embedded: 4, batches: 1 });
    });

    render(<MemoryView />);
    await screen.findByText(/4 memories/);
    fireEvent.click(screen.getByRole('button', { name: /Rebuild semantic index/i }));

    await screen.findByText(/embedded 4 of 4 memories/);
    expect(sawPayload).toEqual({}); // no renderer-supplied tenant/org — server-resolved
    expect('tenantId' in (sawPayload ?? {})).toBe(false);
    expect('orgId' in (sawPayload ?? {})).toBe(false);
  });

  it('reports a no-active-org run as LOCAL, not a failure', async () => {
    route(IpcChannel.MemoryBackfill, () => summary({ orgId: null, skippedReason: 'no_active_org' }));
    render(<MemoryView />);
    await screen.findByText(/4 memories/);
    fireEvent.click(screen.getByRole('button', { name: /Rebuild semantic index/i }));
    await screen.findByText(/Working locally/);
  });

  it('shows a truthful message on a governed refusal (RBAC/egress denial), never a fake success', async () => {
    route(IpcChannel.MemoryBackfill, () => {
      throw new Error('UNAUTHORIZED:operations:manage');
    });
    render(<MemoryView />);
    await screen.findByText(/4 memories/);
    fireEvent.click(screen.getByRole('button', { name: /Rebuild semantic index/i }));
    await screen.findByText(/build the semantic index/);
    expect(screen.queryByText(/Semantic index updated/)).toBeNull();
  });
});
