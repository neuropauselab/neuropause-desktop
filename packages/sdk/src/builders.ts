/**
 * Builders for the four package kinds developers can ship: AI Workers,
 * Connectors, Plugins, and Enterprise Extensions. Each produces a validated
 * `ListingManifest` ready to publish via `client.marketplace.publishVersion`.
 * Validation fails fast on a missing name, version, or entry point.
 */
import type { ListingKind, ListingManifest } from '@neuropause/shared';

export interface BaseSpec {
  name: string;
  version: string;
  entry: string;
  permissions?: string[];
  capabilities?: string[];
  dependencies?: string[];
  network?: string[];
  metadata?: Record<string, string>;
}

export interface PackageDefinition {
  readonly kind: ListingKind;
  readonly manifest: ListingManifest;
  toManifest(): ListingManifest;
}

function build(kind: ListingKind, spec: BaseSpec): ListingManifest {
  if (!spec.name) throw new Error('Package name is required.');
  if (!spec.version) throw new Error('Package version is required.');
  if (!spec.entry) throw new Error('Package entry point is required.');
  return {
    kind,
    name: spec.name,
    version: spec.version,
    entry: spec.entry,
    permissions: spec.permissions ?? [],
    capabilities: spec.capabilities ?? [],
    dependencies: spec.dependencies ?? [],
    network: spec.network ?? [],
    metadata: spec.metadata ?? {},
  };
}

function definition(kind: ListingKind, spec: BaseSpec): PackageDefinition {
  const manifest = build(kind, spec);
  return { kind, manifest, toManifest: () => manifest };
}

export interface WorkerSpec extends BaseSpec {
  role?: string;
}

export function defineWorker(spec: WorkerSpec): PackageDefinition {
  const metadata = { ...(spec.metadata ?? {}) };
  if (spec.role) metadata.role = spec.role;
  return definition('ai_worker', { ...spec, capabilities: spec.capabilities ?? ['summarize'], metadata });
}

export function defineConnector(spec: BaseSpec): PackageDefinition {
  return definition('connector', { ...spec, capabilities: spec.capabilities ?? ['sync'] });
}

export function definePlugin(spec: BaseSpec): PackageDefinition {
  return definition('plugin', spec);
}

export function defineExtension(spec: BaseSpec): PackageDefinition {
  return definition('enterprise_template', spec);
}
