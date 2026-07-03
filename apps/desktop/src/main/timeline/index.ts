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
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { unifiedStore } from '../unified/storeInstance';
import { EnterpriseTimeline } from './enterpriseTimeline';

const log = createLogger('enterprise-timeline');

let timelineRef: EnterpriseTimeline | null = null;
/** The shared façade, available once initialized (used by Enterprise Search). */
export function getEnterpriseTimeline(): EnterpriseTimeline | null {
  return timelineRef;
}

export interface EnterpriseTimelineDeps {
  broadcast: (channel: string, payload: unknown) => void;
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
  const broadcastStats = (): void =>
    deps.broadcast(IpcChannel.EnterpriseTimelineEventBroadcast, timeline.stats());
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
