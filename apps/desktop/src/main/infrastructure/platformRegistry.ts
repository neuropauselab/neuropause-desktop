/**
 * The Cloud Platform registry (P6 — Cloud & Infrastructure Control Plane).
 *
 * The infrastructure analog of the connector adapter registry (`unified/sync/registry.ts`) — a module-level
 * map of `CloudPlatformAdapter`s keyed by platform id. A Cloud Platform is NOT a connector, so it lives in
 * its own registry (never the adapter registry), but the shape and API deliberately mirror it: adding a
 * platform later is one `registerPlatform(...)` call. This registry holds DISCOVERY adapters (the collectors
 * that call provider APIs); it is empty until a concrete platform is built in P6.1 — the platform CATALOG
 * (metadata) lives separately in `cloudPlatformManifests.ts`, so the Cloud Platform Center lists platforms
 * as "not configured" before any adapter exists.
 */
import { describeCloudPlatform, type CloudPlatformAdapter, type DiscoveryCapability } from '@neuropause/shared';

const PLATFORMS = new Map<string, CloudPlatformAdapter>();

/** Register a discovery adapter for a cloud platform (idempotent per id — last registration wins). */
export function registerPlatform(adapter: CloudPlatformAdapter): void {
  PLATFORMS.set(adapter.platformId, adapter);
}

/** The registered adapter for a platform, or null. */
export function getPlatform(platformId: string): CloudPlatformAdapter | null {
  return PLATFORMS.get(platformId) ?? null;
}

/** All registered platform ids. */
export function platformIds(): string[] {
  return [...PLATFORMS.keys()];
}

/** Every registered platform's discovery capability (pure projection). */
export function describePlatforms(): DiscoveryCapability[] {
  return [...PLATFORMS.values()].map(describeCloudPlatform);
}

/** Test/teardown helper — clear the registry. */
export function clearPlatforms(): void {
  PLATFORMS.clear();
}
