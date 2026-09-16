import { createContext, useContext } from 'react';

/**
 * S17 — the shell-wide "connect a cloud account" action, so any local-mode
 * honest-absence surface (deep in the tree) can offer the same real sign-in path
 * the top `LocalModeBanner` does, without threading a callback through everything.
 * The default is a no-op (a surface rendered outside local mode never calls it).
 */
const LocalModeConnectContext = createContext<() => void>(() => {});

export const LocalModeConnectProvider = LocalModeConnectContext.Provider;

/** The shell's "reveal the sign-in surface" action (no-op outside local mode). */
export function useLocalModeConnect(): () => void {
  return useContext(LocalModeConnectContext);
}
