/**
 * S147 — the governed memory-index REBUILD goes live at the renderer.
 *
 * `memory:rebuild` (IpcChannel.MemoryRebuild) was fully governed in main — RBAC `operations:manage`
 * (memoryAuthzGate), runs under the server-resolved principal via `runAsPrincipal`, no-ops without an
 * active org, and re-projects the memory store returning fresh MemoryCounts — and its typed
 * `ipc.memory.rebuild` helper existed, but NO production surface ever called it: an operator could
 * search memory but never rebuild a stale index. S147 surfaces a "Rebuild index" action on MemoryView.
 *
 * These tests prove the renderer reachability the surface creates: the button dispatches
 * `memory:rebuild` with an EMPTY payload (the renderer supplies no tenant/org — server-resolved),
 * the returned counts update the header, and a governed refusal (RBAC denial → thrown IPC error) is
 * shown as a truthful message rather than a fabricated success.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { MemoryView } from '@renderer/views/MemoryView';

const counts = (total: number, lastBuiltAt: string | null) => ({ total, byKind: {}, byOrigin: {}, lastBuiltAt });

beforeEach(() => {
  cleanup();
  clearRoutes();
  // MemoryView loads counts on mount and runs a debounced recall; route both to quiet fixtures.
  route(IpcChannel.MemorySemanticRecall, () => ({ hits: [] }));
  route(IpcChannel.MemoryRecall, () => ({ hits: [] }));
});
afterEach(() => cleanup());

describe('S147 · memory-index rebuild renderer reachability', () => {
  it('dispatches memory:rebuild with an EMPTY payload and reflects the fresh counts', async () => {
    route(IpcChannel.MemoryCounts, () => counts(3, null));
    let sawPayload: Record<string, unknown> | undefined;
    route(IpcChannel.MemoryRebuild, (p) => {
      sawPayload = p as Record<string, unknown>;
      return counts(5, '2026-09-06T00:00:00.000Z');
    });

    render(<MemoryView />);
    await screen.findByText(/3 memories/);
    fireEvent.click(screen.getByRole('button', { name: /Rebuild index/i }));

    await screen.findByText('Memory index rebuilt.');
    expect(sawPayload).toEqual({}); // no renderer-supplied tenant/org — server-resolved
    expect('tenantId' in (sawPayload ?? {})).toBe(false);
    expect('orgId' in (sawPayload ?? {})).toBe(false);
    await screen.findByText(/5 memories/); // header reflects the rebuilt counts
  });

  it('shows a truthful message on a governed refusal (RBAC denial), never a fake success', async () => {
    route(IpcChannel.MemoryCounts, () => counts(3, null));
    route(IpcChannel.MemoryRebuild, () => {
      throw new Error('UNAUTHORIZED:operations:manage');
    });

    render(<MemoryView />);
    await screen.findByText(/3 memories/);
    fireEvent.click(screen.getByRole('button', { name: /Rebuild index/i }));

    await screen.findByText(/rebuild the memory index/);
    expect(screen.queryByText('Memory index rebuilt.')).toBeNull();
  });
});
