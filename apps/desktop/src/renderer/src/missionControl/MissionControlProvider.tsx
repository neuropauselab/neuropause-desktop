/**
 * NCEA 11.0 — Mission Control provider (the data-binding seam).
 *
 * Mission Control renders runtime PROJECTIONS; it holds no runtime state of its
 * own. The host supplies a `MissionControlSnapshot` — assembled from the existing
 * providers / IPC bridge (organizations, workspaces, workforce, tasks,
 * connectors, activity, governance) — and this context makes it available to the
 * pure view-model. Read-only by design.
 *
 * Phase 6 Stage 2: the live binding now exists — `MissionControlHost` assembles
 * the snapshot from the real IPC feeds (see missionControlFeed.ts) and passes
 * `meta` alongside it: per-tile availability (loading / ready / unavailable with
 * an explicit reason), dashboard extras, and a refresh handle. `meta` is
 * additive and optional; `useMissionControl()` keeps its original signature, so
 * every pre-Stage-2 consumer and test is untouched.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { MissionControlSnapshot } from './missionControlModel';
import type { FeedAvailability, MissionControlExtras } from './missionControlFeed';

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

/** Live-feed metadata the Stage 2 host provides beside the snapshot. */
export interface MissionControlMeta {
  availability: FeedAvailability;
  extras: MissionControlExtras;
  refresh: () => void;
}

const MissionControlContext = createContext<MissionControlSnapshot>(EMPTY_SNAPSHOT);
const MissionControlMetaContext = createContext<MissionControlMeta | null>(null);

export function MissionControlProvider({
  snapshot,
  meta,
  children,
}: {
  snapshot: MissionControlSnapshot;
  /** Optional Stage 2 live-feed metadata; absent for headless/static hosts. */
  meta?: MissionControlMeta | null;
  children: ReactNode;
}): JSX.Element {
  return (
    <MissionControlContext.Provider value={snapshot}>
      <MissionControlMetaContext.Provider value={meta ?? null}>{children}</MissionControlMetaContext.Provider>
    </MissionControlContext.Provider>
  );
}

export function useMissionControl(): MissionControlSnapshot {
  return useContext(MissionControlContext);
}

/** Stage 2 — per-tile availability + extras; null when no live host is bound. */
export function useMissionControlMeta(): MissionControlMeta | null {
  return useContext(MissionControlMetaContext);
}
