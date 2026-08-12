/**
 * Runtime adapter contracts. The supervisor owns instance state and lifecycle
 * transitions; adapters implement how a given app *kind* is actually launched,
 * stopped, suspended, resumed, and sampled. This keeps the lifecycle logic in
 * one place while letting web, process, and (future) container runtimes plug in
 * behind a single interface — the basis for multiple simultaneous runtimes.
 */
import type { ChildProcess } from 'node:child_process';
import type {
  AppType,
  HealthStatus,
  OpenAppRequest,
  ResourceSample,
  RuntimeEvent,
  RuntimeStatus,
} from '@neuropause/shared';
import type { RegistryEntry } from '../registry/registry';

/**
 * WHO STARTED THIS PROCESS. P13C ROUND 11 — M-3.
 *
 * A `RuntimeInstance` carried no owner at all. The catalogue row it launches
 * from is legitimately INSTALL_GLOBAL — one copy of the app on one machine — but
 * a RUNNING INSTANCE IS NOT THE CATALOGUE ROW. It is a live process that one
 * tenant started, and `list()` reported every one of them (`appSlug`, `pid`,
 * `startedAt`, `uptimeMs`, `restarts`, CPU and memory) to any caller, while
 * `requireInstance(instanceId)` resolved a renderer-supplied id with no
 * ownership comparison at all. So a Manager in organization A could enumerate
 * and then stop, suspend or restart a process organization B launched.
 *
 * The type is a DISCRIMINATED UNION rather than `string | null` on purpose. This
 * program's history is fields whose empty value meant "nobody thought about it",
 * so the two legitimate answers are spelled out and there is no third:
 *
 *   `tenant`          — one organization launched it, and only that organization
 *                       may see or control it.
 *   `unowned-install` — this install has no organization at all (the single-user
 *                       desktop case, and the same `''` partition
 *                       `registry.tenantKey()` uses for launch counters). It is
 *                       one audience, not a shared one: on an install where no
 *                       tenant resolves there is nobody else to be.
 *
 * There is deliberately no `'global'` / `'any'` member. An instance visible to
 * every tenant is the finding, not a state worth representing.
 */
export type RuntimeInstanceOwner =
  | { readonly kind: 'tenant'; readonly tenantId: string }
  | { readonly kind: 'unowned-install' };

/** The owner for a tenant key, using `''` for "this install has no tenant". */
export function ownerForTenantKey(tenantKey: string): RuntimeInstanceOwner {
  return tenantKey === '' ? { kind: 'unowned-install' } : { kind: 'tenant', tenantId: tenantKey };
}

/** Same audience? Compared structurally, never by identity. */
export function sameOwner(a: RuntimeInstanceOwner, b: RuntimeInstanceOwner): boolean {
  if (a.kind === 'tenant' && b.kind === 'tenant') return a.tenantId === b.tenantId;
  return a.kind === b.kind;
}

export interface RuntimeInstance {
  instanceId: string;
  /**
   * REQUIRED. The audience this live process belongs to — see
   * `RuntimeInstanceOwner`. Non-optional so an instance created without an
   * answer does not compile, rather than defaulting to everyone.
   */
  owner: RuntimeInstanceOwner;
  slug: string;
  name: string;
  kind: AppType;
  status: RuntimeStatus;
  health: HealthStatus;
  pid: number | null;
  child: ChildProcess | null;
  launchUrl: string | null;
  startedAt: number | null;
  restarts: number;
  lastError: string | null;
  lastResource: ResourceSample | null;
  /** Set when the supervisor stops an instance intentionally (suppresses crash). */
  intentionalStop: boolean;
}

export interface LaunchContext {
  entry: RegistryEntry;
  instance: RuntimeInstance;
  /** Ask the renderer to open a Workspace tab (web apps). */
  openApp: (req: OpenAppRequest) => void;
  /** Emit a runtime event (lifecycle/health/crash/log). */
  emit: (event: Omit<RuntimeEvent, 'instanceId' | 'appSlug' | 'at'>) => void;
}

export interface RuntimeAdapter {
  /** App kinds this adapter handles. */
  readonly kinds: readonly AppType[];
  launch(ctx: LaunchContext): Promise<void>;
  stop(instance: RuntimeInstance): Promise<void>;
  suspend(instance: RuntimeInstance): Promise<void>;
  resume(instance: RuntimeInstance): Promise<void>;
  sampleResource(instance: RuntimeInstance): Promise<ResourceSample | null>;
}

export function nowSample(cpuPercent: number | null, memoryMb: number | null): ResourceSample {
  return { cpuPercent, memoryMb, sampledAt: new Date().toISOString() };
}
