/**
 * Enterprise Timeline composition root. Builds the façade over the live platform
 * Timeline query and the UDM, exposes query/replay/stats/export over the secure
 * IPC bridge, and broadcasts a stats snapshot when UDM activity changes. The
 * built instance is shared (getEnterpriseTimeline) so Enterprise Search can use
 * it as its fourth source.
 */
import type {
  EnterpriseTimelineQueryRequest as TQuery,
  EnterpriseTimelineReplayRequest as TReplay,
  TimelineQuery,
  TimelinePage,
} from '@neuropause/shared';
import {
  EmptyRequest,
  EnterpriseTimelineQueryRequest,
  EnterpriseTimelineReplayRequest,
  IpcChannel,
} from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { unifiedStore } from '../unified/storeInstance';
import { EnterpriseTimeline } from './enterpriseTimeline';
import { runOutsidePrincipal } from '../tenancy/backgroundPrincipal';

const log = createLogger('enterprise-timeline');

let timelineRef: EnterpriseTimeline | null = null;
/** The shared façade, available once initialized (used by Enterprise Search). */
export function getEnterpriseTimeline(): EnterpriseTimeline | null {
  return timelineRef;
}

export interface EnterpriseTimelineDeps {
  broadcast: IpcBroadcaster;
  platformQuery: (q: TimelineQuery) => TimelinePage;
}

export interface EnterpriseTimelineSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
}

export function initEnterpriseTimeline(deps: EnterpriseTimelineDeps): EnterpriseTimelineSubsystem {
  const timeline = new EnterpriseTimeline({
    platformQuery: deps.platformQuery,
    listEntities: () => unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items,
  });
  timelineRef = timeline;

  let timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * P13C ROUND 7 — COMPUTED FOR THE VIEWER, NOT FOR THE JOB.
   *
   * THE CLASS: a background pass runs as tenant A while the window in front of
   * the user is showing tenant B. Any value computed for the RENDERER during
   * that pass is computed under A's principal, so a correctly-scoped store
   * honestly answers for A — and the answer is delivered into B's window.
   *
   * The store is not the defect. The store is right, which is exactly why this
   * survived seven rounds of auditing stores: every isolation test on it passes,
   * because the boundary holds and the READER is standing on the wrong side of
   * it.
   *
   * `runOutsidePrincipal` exists for precisely this and had ONE caller in the
   * whole main process (the unread badge), with a comment describing the general
   * case. This is the general case, in the five other places it occurs.
   *
   * It grants nothing: leaving the principal falls back to the SESSION, so the
   * value is what the signed-in viewer is entitled to and never more.
   */
  // The 800ms debounce does NOT clear the principal: AsyncLocalStorage
  // propagates into timer callbacks, so a `setTimeout` preserves it rather than
  // escaping it. That is the opposite of the intuition, and it is why this one
  // looked safe.
  const broadcastStats = (): void =>
    deps.broadcast(
      IpcChannel.EnterpriseTimelineEventBroadcast,
      runOutsidePrincipal(() => timeline.stats()),
    );
  const schedule = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      broadcastStats();
    }, 800);
  };
  unifiedStore.on('changed', schedule);

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.EnterpriseTimelineQuery,
      schema: EnterpriseTimelineQueryRequest,
      handler: (p) => timeline.query(p as TQuery),
    },
    {
      channel: IpcChannel.EnterpriseTimelineReplay,
      schema: EnterpriseTimelineReplayRequest,
      handler: (p) => timeline.replay(p as TReplay),
    },
    { channel: IpcChannel.EnterpriseTimelineStats, schema: EmptyRequest, handler: () => timeline.stats() },
    {
      channel: IpcChannel.EnterpriseTimelineExport,
      schema: EmptyRequest,
      handler: () => timeline.export(),
    },
  ];

  log.info('Enterprise timeline initialized', timeline.stats());

  return {
    handlers,
    dispose: () => {
      unifiedStore.off('changed', schedule);
      if (timer) clearTimeout(timer);
      timelineRef = null;
    },
  };
}
