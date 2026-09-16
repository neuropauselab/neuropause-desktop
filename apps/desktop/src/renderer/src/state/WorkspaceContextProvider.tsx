/**
 * Phase 6 Stage 1 — Workspace Context provider.
 *
 * Bootstraps the multi-workspace foundation from the main-process store (one
 * IPC call, which also performs the one-time legacy migration), then scopes
 * the entire shell to the active workspace: `WorkspaceScopedShellProvider`
 * remounts the ShellProvider whenever the active workspace changes (React
 * `key`), seeding it from that workspace's persisted snapshot and streaming
 * snapshot changes back to the store (debounced, flushed on switch).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ShellSnapshotDto, WorkspaceContextStateDto, WorkspaceTemplateId } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { prefs } from '@renderer/lib/preferences';
import { createLogger } from '@renderer/lib/logger';
import { Spinner } from '@renderer/components/Spinner';
import { ShellProvider } from './ShellProvider';
import { legacyShellSnapshot } from './workspaceContextModel';

const log = createLogger('workspace-ctx');

interface WorkspaceContextValue extends WorkspaceContextStateDto {
  createWorkspace: (name: string, template: WorkspaceTemplateId) => Promise<void>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
  /** Called by the scoped ShellProvider on every durable shell change. */
  persistSnapshot: (snapshot: ShellSnapshotDto) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceContextProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<WorkspaceContextStateDto | null>(null);
  const latestSnapshot = useRef<ShellSnapshotDto | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string>('');

  // One-shot bootstrap; carries the legacy single-context session so a
  // pre-Stage-1 profile keeps its exact tabs + section as "Default".
  useEffect(() => {
    let cancelled = false;
    ipc.workspaceContexts
      .bootstrap(legacyShellSnapshot((key, fallback) => prefs.read(key, fallback)))
      .then((s) => {
        if (!cancelled) {
          activeIdRef.current = s.activeId;
          latestSnapshot.current = s.activeSnapshot;
          setState(s);
        }
      })
      .catch((err) => {
        // Never block the app on the store: degrade to a single implicit
        // workspace (the legacy behaviour) and log loudly.
        log.warn('workspace bootstrap failed; running unscoped', err);
        if (!cancelled) {
          activeIdRef.current = '';
          setState({
            workspaces: [],
            activeId: '',
            activeSnapshot: { activeSection: 'intent-home', tabs: [], activeTabId: null },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Push the latest snapshot for the ACTIVE workspace to the store now. */
  const flushSnapshot = useCallback(async (): Promise<void> => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    const id = activeIdRef.current;
    const snap = latestSnapshot.current;
    if (!id || !snap) return;
    try {
      await ipc.workspaceContexts.updateSnapshot(id, snap);
    } catch (err) {
      log.warn('snapshot persist failed', err);
    }
  }, []);

  const persistSnapshot = useCallback(
    (snapshot: ShellSnapshotDto): void => {
      latestSnapshot.current = snapshot;
      if (!activeIdRef.current) return;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => void flushSnapshot(), 400);
    },
    [flushSnapshot],
  );

  // Best-effort flush when the window is going away (quit also flushes in main).
  useEffect(() => {
    const onUnload = (): void => void flushSnapshot();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [flushSnapshot]);

  const apply = useCallback((s: WorkspaceContextStateDto): void => {
    activeIdRef.current = s.activeId;
    latestSnapshot.current = s.activeSnapshot;
    setState(s);
  }, []);

  const switchWorkspace = useCallback(
    async (id: string): Promise<void> => {
      if (id === activeIdRef.current) return;
      await flushSnapshot();
      apply(await ipc.workspaceContexts.switch(id));
    },
    [apply, flushSnapshot],
  );

  const createWorkspace = useCallback(
    async (name: string, template: WorkspaceTemplateId): Promise<void> => {
      await flushSnapshot();
      apply(await ipc.workspaceContexts.create(name, template));
    },
    [apply, flushSnapshot],
  );

  const renameWorkspace = useCallback(
    async (id: string, name: string): Promise<void> => {
      apply(await ipc.workspaceContexts.rename(id, name));
    },
    [apply],
  );

  const deleteWorkspace = useCallback(
    async (id: string): Promise<void> => {
      apply(await ipc.workspaceContexts.remove(id));
    },
    [apply],
  );

  const value = useMemo<WorkspaceContextValue | null>(
    () =>
      state
        ? {
            ...state,
            createWorkspace,
            renameWorkspace,
            deleteWorkspace,
            switchWorkspace,
            persistSnapshot,
          }
        : null,
    [state, createWorkspace, renameWorkspace, deleteWorkspace, switchWorkspace, persistSnapshot],
  );

  if (!value) {
    return (
      <div className="app-bg flex h-screen w-screen items-center justify-center">
        <div className="text-muted flex flex-col items-center gap-3">
          <Spinner size={22} />
          <span className="text-sm">Opening workspace…</span>
        </div>
      </div>
    );
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceContexts(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspaceContexts must be used within WorkspaceContextProvider');
  return ctx;
}

/**
 * The workspace-scoped shell: remounts the ShellProvider per active workspace
 * (via `key`) so all shell state re-initializes from that workspace's
 * snapshot, and wires durable shell changes back into the store. Drop-in
 * replacement for a bare `<ShellProvider>` at the App root.
 */
export function WorkspaceScopedShellProvider({ children }: { children: ReactNode }): JSX.Element {
  return (
    <WorkspaceContextProvider>
      <ScopedShell>{children}</ScopedShell>
    </WorkspaceContextProvider>
  );
}

/**
 * Keyed on the local VIEW id only, deliberately.
 *
 * A TENANT switch must NOT remount the whole shell: that resets navigation and
 * would drop the user out of the section they were reading, and its correctness
 * would rest on snapshot-persistence timing. Tenant freshness is handled one
 * level down, where the view itself is remounted so it refetches while the
 * sidebar, active section and shell state survive — see
 * `shell/useTenantSwitchEpoch.ts` and its use in `AppShell`.
 */
function ScopedShell({ children }: { children: ReactNode }): JSX.Element {
  const { activeId, activeSnapshot, persistSnapshot } = useWorkspaceContexts();
  return (
    <ShellProvider
      key={activeId || 'unscoped'}
      initialSnapshot={activeId ? activeSnapshot : undefined}
      onSnapshotChange={activeId ? persistSnapshot : undefined}
    >
      {children}
    </ShellProvider>
  );
}
