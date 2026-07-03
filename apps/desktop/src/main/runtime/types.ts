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

export interface RuntimeInstance {
  instanceId: string;
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
