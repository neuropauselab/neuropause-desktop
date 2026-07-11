/**
 * Internal shapes for the P3.0 Enterprise REST API layer (main-process only).
 *
 * A route maps a REST method+path onto an EXISTING secure IPC channel (records,
 * graph, timeline, context, …) or a small composed "special" handler (health,
 * metrics, bulk). Nothing here re-implements business logic — `buildPayload`
 * only translates path params / query / body into the channel's existing payload.
 */
import type { ApiListControls, ApiRouteInfo, IpcChannelName } from '@neuropause/shared';

export interface RouteContext {
  params: Record<string, string>;
  query: Record<string, string | number | boolean | undefined>;
  body: unknown;
  controls: ApiListControls;
}

/** Deps a composed "special" route can use — dispatch to existing channels, read metrics. */
export interface SpecialRouteDeps {
  dispatch: (channel: IpcChannelName, payload: Record<string, unknown>) => Promise<unknown>;
  metrics: (windowDays: number) => unknown;
  routeCount: number;
  version: string;
  now: () => number;
}

/** A route that dispatches to a single existing channel. `list` post-processes the array result. */
export interface ChannelRoute extends ApiRouteInfo {
  kind: 'channel' | 'list';
  channel: IpcChannelName;
  buildPayload: (ctx: RouteContext) => Record<string, unknown>;
  /** For list routes: pull the array out of the handler result (default: the result IS the array). */
  extract?: (result: unknown) => unknown[];
}

/** A composed route (no single channel): health, metrics, bulk. */
export interface SpecialRoute extends ApiRouteInfo {
  kind: 'special';
  run: (ctx: RouteContext, deps: SpecialRouteDeps) => Promise<unknown> | unknown;
}

export type ApiRoute = ChannelRoute | SpecialRoute;
