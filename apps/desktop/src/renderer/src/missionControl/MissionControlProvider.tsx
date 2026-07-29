/**
 * NCEA 11.0 — Mission Control provider (the data-binding seam).
 *
 * Mission Control renders runtime PROJECTIONS; it holds no runtime state of its
 * own. The host supplies a `MissionControlSnapshot` — assembled from the existing
 * providers / IPC bridge (organizations, workspaces, workforce, tasks,
 * connectors, activity, governance) — and this context makes it available to the
 * pure view-model. Binding the snapshot to the LIVE Enterprise Runtime happens in
 * the Electron host (the IPC seam), which is why it is not exercised by the
 * headless model tests. Read-only by design.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { MissionControlSnapshot } from './missionControlModel';

export const EMPTY_SNAPSHOT: MissionControlSnapshot = {
  organizations: [],
  workspaces: [],
  people: [],
  workers: [],
  projects: [],
  tasks: [],
  documents: [],
  connectors: [],
  activity: [],
  automation: { workflows: 0, triggers: 0, running: 0, queued: 0, retrying: 0, failures24h: 0 },
  governance: { auditValid: true, auditRecords: 0, events: 0, pendingApprovals: 0 },
  runtimeHealth: 'healthy',
  costUsd: 0,
  pendingApprovals: 0,
};

const MissionControlContext = createContext<MissionControlSnapshot>(EMPTY_SNAPSHOT);

export function MissionControlProvider({
  snapshot,
  children,
}: {
  snapshot: MissionControlSnapshot;
  children: ReactNode;
}): JSX.Element {
  return <MissionControlContext.Provider value={snapshot}>{children}</MissionControlContext.Provider>;
}

export function useMissionControl(): MissionControlSnapshot {
  return useContext(MissionControlContext);
}
