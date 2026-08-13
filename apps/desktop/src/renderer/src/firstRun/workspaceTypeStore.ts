/**
 * The active workspace type, as a tiny external store.
 *
 * One writer (the shell, after loading the experience profile — and the
 * first-run flow / upgrade card when the user changes it), many readers (the
 * sidebar's nav filter, the AI Home, the command palette). Deliberately not
 * ShellProvider state: the provider owns layout state with persistence
 * semantics of its own, and this value's source of truth is the MAIN process
 * profile store — the renderer only mirrors it.
 */
import { useSyncExternalStore } from 'react';
import type { WorkspaceType } from '@neuropause/shared';

let current: WorkspaceType | null = null;
const listeners = new Set<() => void>();

export function setWorkspaceType(type: WorkspaceType | null): void {
  if (current === type) return;
  current = type;
  for (const listener of [...listeners]) listener();
}

export function getWorkspaceType(): WorkspaceType | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook over the store. */
export function useWorkspaceType(): WorkspaceType | null {
  return useSyncExternalStore(subscribe, getWorkspaceType);
}
