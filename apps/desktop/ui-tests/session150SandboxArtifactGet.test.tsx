/**
 * S150 — the governed single-artifact fetch goes live at the renderer (FG-S149-SANDBOX-ARTIFACT-GET).
 *
 * `sandbox:artifact.get` (IpcChannel.SandboxArtifactGet) was fully governed in main — `requireAuth: true,
 * permission: read` (sandbox:read), server-side, `artifacts.get(id): Artifact | null` — with its sibling
 * `sandbox:artifact.list` already wired, but no renderer path: ArtifactsPanel listed each artifact
 * (name/kind/size) as display-only. S150 adds the one authorized frozen IpcResponseMap line, the typed
 * `ipc.sandbox.artifact(id)` helper, and an inline artifact-detail expander on ArtifactsPanel.
 *
 * These tests isolate the panel (mocking useSandbox with a fixed execDetail) so the real
 * `ipc.sandbox.artifact` helper still routes through the harness, and prove: (1) opening an artifact
 * dispatches `sandbox:artifact.get` with ONLY `{ id }` — no renderer-supplied tenant/org; (2) inline
 * content renders; (3) a null (missing/denied) result renders an honest empty state; (4) a thrown
 * (unauthorized) call renders a truthful message, never fabricated content.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { ArtifactsPanel } from '@renderer/sandbox/panels/ArtifactsPanel';

const artifact = (over: Record<string, unknown> = {}) => ({
  id: 'art-1', executionId: 'exec-1', workspaceId: 'sbw-1', kind: 'log', name: 'run.log',
  mimeType: 'text/plain', sizeBytes: 42, storageRef: null, inline: null, createdAt: '2026-09-06T00:00:00.000Z',
  metadata: {}, ...over,
});

const sandboxState: { execDetail: unknown; selectedExecutionId: string | null } = {
  selectedExecutionId: 'exec-1',
  execDetail: {
    execution: { id: 'exec-1', scenarioId: 'scn-1', scenarioVersion: 1, status: 'passed', durationMs: 1000 },
    timeline: [], result: null, report: null,
    artifacts: [artifact()],
  },
};

vi.mock('@renderer/sandbox/SandboxProvider', () => ({
  useSandbox: () => ({
    dashboard: { artifacts: { total: 1, byKind: { log: 1 } } },
    history: [],
    execDetail: sandboxState.execDetail,
    selectedExecutionId: sandboxState.selectedExecutionId,
    selectExecution: vi.fn(),
    clearExecution: vi.fn(),
    generateReport: vi.fn(),
  }),
}));

beforeEach(() => {
  cleanup();
  clearRoutes();
});
afterEach(() => cleanup());

describe('S150 · sandbox single-artifact fetch renderer wiring', () => {
  it('opening an artifact dispatches sandbox:artifact.get with ONLY { id } and renders inline content', async () => {
    let sawPayload: Record<string, unknown> | undefined;
    route(IpcChannel.SandboxArtifactGet, (p) => {
      sawPayload = p as Record<string, unknown>;
      return artifact({ inline: 'hello from the run log' });
    });

    render(<ArtifactsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /run\.log/ }));

    await screen.findByText(/hello from the run log/);
    expect(sawPayload).toEqual({ id: 'art-1' }); // ONLY the id — tenant/workspace resolved server-side
    expect('tenantId' in (sawPayload ?? {})).toBe(false);
    expect('orgId' in (sawPayload ?? {})).toBe(false);
    expect('workspaceId' in (sawPayload ?? {})).toBe(false);
  });

  it('a binary artifact (no inline) shows the external-storage note, not fake content', async () => {
    route(IpcChannel.SandboxArtifactGet, () => artifact({ inline: null, storageRef: 'blob://x', kind: 'screenshot' }));
    render(<ArtifactsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /run\.log/ }));
    await screen.findByText(/stored externally/i);
  });

  it('a null result (missing/denied) renders an honest empty state', async () => {
    route(IpcChannel.SandboxArtifactGet, () => null);
    render(<ArtifactsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /run\.log/ }));
    await screen.findByText(/no longer available/i);
  });

  it('a thrown (unauthorized) fetch renders a truthful message, never fabricated content', async () => {
    route(IpcChannel.SandboxArtifactGet, () => {
      throw new Error('UNAUTHORIZED:sandbox:read');
    });
    render(<ArtifactsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /run\.log/ }));
    await screen.findByText(/could not be opened/i);
  });
});
