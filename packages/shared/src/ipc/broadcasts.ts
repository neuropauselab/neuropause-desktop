/**
 * The push half of the IPC contract: channel -> the payload the main process sends.
 *
 * A7. `ipc/responses.ts` describes what a channel RESOLVES to when the renderer asks;
 * this describes what it CARRIES when the main process volunteers. Both directions
 * had the same hole and it was worse here. Every broadcast funnels through one
 * primitive — `broadcast(channel: string, payload: unknown)` in `main/index.ts`,
 * the only `webContents.send` in the process — so `payload` was contextually typed
 * `unknown` at all 34 send sites and nothing about the value being sent was ever
 * checked. The renderer then asserted a shape at each `subscribe` call. Two
 * independent descriptions of one wire, with no relation between them.
 *
 * Worse than the invoke side because five channels were not merely unchecked but
 * actively wrong-by-omission: `nps:progress`, `runtime:event`, `runtime:openApp`,
 * `plugins:event` and `update:event` all originate from `node:events` emitters whose
 * listeners are `(...args: any[]) => void`, so the payload arrived at the send site
 * as `any` and `any` flowed into `unknown` without complaint. `infra:event` was the
 * sharpest case: `{ kind: 'resources', ...e }` with `e: any` collapses the entire
 * object literal to `any`, discarding even the parts that were written down. Those
 * emitters are now generically typed at their class declarations, so the payload has
 * a real type before it reaches `broadcast` and this map is what checks it.
 *
 * The map and everything derived from it are types, erased at build time. The one
 * value this module emits is `BROADCAST_CHANNELS` at the foot of the file, which exists
 * so a test can compare this map against the preload's allowlist — a mismatch there is
 * a runtime failure the compiler cannot see. A broadcast is fire-and-forget by nature:
 * there is no caller to return an error to, which is exactly why the compile-time check
 * has to carry the weight here.
 */
import type { AuthStatus } from '../types/auth';
import type { MenuCommandPayload, TrayCommandPayload } from '../types/app';
import type { ConnectorEvent, ConnectorSyncSnapshot } from '../types/connectors';
import type { ConnectorLifecycleEvent } from '../types/connectorRuntime';
import type { ThemeSource } from './contracts';
import type { EnterpriseModuleEvent } from '../types/enterpriseModule';
import type { EnterpriseTimelineStats } from '../types/enterpriseTimeline';
import type { GraphCounts } from '../types/graph';
import type { MemoryCounts } from '../types/memory';
import type { NotificationInboxEvent } from '../types/notifications';
import type { PlatformEvent } from '../types/platform';
import type { PluginHostEvent } from '../types/plugin';
import type { NpsProgressEvent, OpenAppRequest, RuntimeEvent } from '../types/runtime';
import type { SandboxEvent } from '../types/sandbox';
import type { UnifiedCounts } from '../types/unified';
import type { UpdateEvent } from '../types/update';
import type { AssistantEvent } from '../types/assistant';
import type { WebhookDeliveryStats } from '../types/webhook';
import type { IpcChannelName } from './channels';

/**
 * "A store behind this subsystem changed; re-read what you are showing."
 *
 * Four subsystems — cloud, ecosystem, enterprise and federation — each bridge several
 * of their own stores onto one channel this way. `kind` names which store, and is
 * deliberately open: it is a refresh hint, not a command, and a renderer that does not
 * recognise a kind still knows to refetch.
 */
export interface IpcStoreChangedEvent {
  /** Which backing store changed — e.g. `'tenancy'`, `'marketplace'`, `'governance'`. */
  kind: string;
  /** ISO-8601 timestamp of the change. */
  at: string;
}

/**
 * The two things the infrastructure subsystem pushes, discriminated by `kind`.
 *
 * This one is a union rather than a `IpcStoreChangedEvent` because its two send sites
 * spread genuinely different store payloads — the resource store reports which ids
 * moved, the discovery-state store reports which account was scanned — and both are
 * useful to a renderer that wants to refresh narrowly.
 */
export type InfraChangedEvent =
  | { kind: 'resources'; ids: string[] }
  | { kind: 'discovery'; platformId: string; accountId: string };

/**
 * Marketplace catalog invalidation. Carries an epoch-millisecond stamp rather than the
 * ISO string its siblings use; that difference is on the wire today and is recorded
 * here rather than quietly normalised, since changing it would change what shipped.
 */
export interface MarketplaceChangedEvent {
  at: number;
}

/** Live workforce totals, pushed whenever a worker, job or audit entry changes. */
export interface WorkforceCountsEvent {
  workers: number;
  jobs: number;
  audit: number;
}

/** Payload of the `app:themeChanged` broadcast. */
export interface ThemeChangedEvent {
  source: ThemeSource;
}

/**
 * Channel -> broadcast payload. Keys are the wire strings from `IpcChannel`; the guard
 * below turns a typo into a compile error rather than a phantom entry.
 *
 * Only channels the main process actually sends on appear here. That is the point of
 * the map and not an oversight: a channel with no entry cannot be broadcast and cannot
 * be subscribed to, so adding a push channel means adding its payload type first.
 */
export interface IpcBroadcastMap {
  'assistant:event': AssistantEvent;
  'auth:statusChanged': AuthStatus;
  'app:themeChanged': ThemeChangedEvent;
  'cloud:event': IpcStoreChangedEvent;
  'connectors:event': ConnectorEvent;
  'connectors:lifecycle': ConnectorLifecycleEvent;
  'connectors:sync-state': ConnectorSyncSnapshot[];
  'ecosystem:event': IpcStoreChangedEvent;
  'enterprise:event': IpcStoreChangedEvent;
  'enterprise:module.event': EnterpriseModuleEvent;
  'enterpriseTimeline:event': EnterpriseTimelineStats;
  'fed:event': IpcStoreChangedEvent;
  'graph:event': GraphCounts;
  'infra:event': InfraChangedEvent;
  'marketplace:event': MarketplaceChangedEvent;
  'memory:event': MemoryCounts;
  'menu:command': MenuCommandPayload;
  'notifications:event': NotificationInboxEvent;
  'nps:progress': NpsProgressEvent;
  'platform:event': PlatformEvent;
  'plugins:event': PluginHostEvent;
  'runtime:event': RuntimeEvent;
  'runtime:openApp': OpenAppRequest;
  'sandbox:event': SandboxEvent;
  'tray:command': TrayCommandPayload;
  'unified:event': UnifiedCounts;
  'update:event': UpdateEvent;
  'webhooks:event': WebhookDeliveryStats;
  'workforce:event': WorkforceCountsEvent;
}

/**
 * Compile-time guard, mirroring the one in `responses.ts`. Every key of
 * `IpcBroadcastMap` must be a value of `IpcChannel`; a mistyped key would otherwise
 * sit here describing nothing while its channel looked uncovered. If this is ever
 * non-`never`, `IpcBroadcastChannelName` degrades into the tuple below and every
 * `broadcast`/`subscribe` call stops compiling with the offending key named.
 */
type StrayBroadcastKeys = Exclude<keyof IpcBroadcastMap, IpcChannelName>;

/** Channels the main process pushes on — the domain of `broadcast` and `subscribe`. */
export type IpcBroadcastChannelName = [StrayBroadcastKeys] extends [never]
  ? keyof IpcBroadcastMap
  : ['IpcBroadcastMap has keys that are not IpcChannel values:', StrayBroadcastKeys];

/** The payload channel `C` carries. */
export type IpcBroadcastOf<C extends IpcBroadcastChannelName> = C extends keyof IpcBroadcastMap
  ? IpcBroadcastMap[C]
  : never;

/**
 * The main process's send port, as every subsystem receives it.
 *
 * Subsystems take this as a dependency rather than reaching for `webContents` — the
 * window is owned by `main/index.ts` and nothing else may hold it. Generic over the
 * channel so the payload is checked against that channel's entry above; a subsystem
 * that sends the wrong shape, or invents a channel, does not compile.
 */
export type IpcBroadcaster = <C extends IpcBroadcastChannelName>(
  channel: C,
  payload: IpcBroadcastOf<C>,
) => void;

/**
 * The map's key set, reachable at runtime.
 *
 * Everything above is erased at build time, which leaves one failure the compiler
 * cannot reach: the preload only forwards a subscription when the channel is on
 * `ALL_SUBSCRIBABLE_CHANNELS`, and that list is an ordinary array with no relation to
 * this map. A channel described here but missing from the allowlist compiles, typechecks
 * and lints, then throws `Channel "…" is not subscribable` the first time a page mounts.
 * The reverse — allowlisted but undescribed here — is quieter still: the renderer simply
 * has no way to name the channel. `ipcContract.test.ts` compares the two sets in both
 * directions and needs this end of the comparison as a value.
 *
 * `Record<keyof IpcBroadcastMap, true>` is what keeps that value honest. A key omitted
 * here fails to compile as a missing property, and a key added here that the map does not
 * declare fails as an excess one, so the list cannot drift from the map it stands in for.
 * Its literal form is deliberate: `Object.keys` on the map is impossible (there is no map
 * at runtime to read), and hand-maintaining a plain array would reintroduce exactly the
 * second-source-of-truth this exists to eliminate.
 */
const BROADCAST_CHANNEL_WITNESS: Record<keyof IpcBroadcastMap, true> = {
  'assistant:event': true,
  'auth:statusChanged': true,
  'app:themeChanged': true,
  'cloud:event': true,
  'connectors:event': true,
  'connectors:lifecycle': true,
  'connectors:sync-state': true,
  'ecosystem:event': true,
  'enterprise:event': true,
  'enterprise:module.event': true,
  'enterpriseTimeline:event': true,
  'fed:event': true,
  'graph:event': true,
  'infra:event': true,
  'marketplace:event': true,
  'memory:event': true,
  'menu:command': true,
  'notifications:event': true,
  'nps:progress': true,
  'platform:event': true,
  'plugins:event': true,
  'runtime:event': true,
  'sandbox:event': true,
  'runtime:openApp': true,
  'tray:command': true,
  'unified:event': true,
  'update:event': true,
  'webhooks:event': true,
  'workforce:event': true,
};

/** Every channel `IpcBroadcastMap` describes, as a value. Order is not significant. */
export const BROADCAST_CHANNELS: readonly (keyof IpcBroadcastMap)[] = Object.keys(
  BROADCAST_CHANNEL_WITNESS,
) as (keyof IpcBroadcastMap)[];
