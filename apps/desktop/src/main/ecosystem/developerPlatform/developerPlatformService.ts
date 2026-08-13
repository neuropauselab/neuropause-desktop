/**
 * P12 — Developer Platform service.
 *
 * Orchestrates the pure model over a memoized snapshot composed from the EXISTING ecosystem
 * developer stores via a single injected `readState` reader (the composition root assembles it
 * from the developer registry, marketplace, gateway, billing, and the public-API registry). It
 * caches BOTH the snapshot AND each projection, so repeated reads are O(1) cache hits; the
 * composition root invalidates on any backing-store change. The service holds no state of record.
 */
import type {
  ApiExplorer,
  DeveloperConsole,
  DeveloperPlatformAnalytics,
  DeveloperPlatformOverview,
  PublishingConsole,
  SdkRegistry,
  TemplateRegistry,
} from '@neuropause/shared';
import {
  buildApiExplorer,
  buildDeveloperAnalytics,
  buildDeveloperConsole,
  buildDeveloperPlatformOverview,
  buildPublishingConsole,
  buildSdkRegistry,
  buildTemplateRegistry,
  type DeveloperPlatformState,
} from './developerPlatformModel';
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../../tenancy/tenantMemo';

export interface DeveloperPlatformServiceDeps {
  /**
   * P13C ROUND 3 — H-2. THE TENANT BOUNDARY, AND IT IS REQUIRED.
   *
   * This service memoises a composed snapshot of tenant-derived data. The memo
   * had no key, so a snapshot built while one organization was active was served
   * to the next caller — including the next tenant's pass of a fanned-out
   * background job, which announces no switch and therefore defeated the switch
   * listener the sibling platforms rely on.
   *
   * Required rather than optional so a composition root that forgets it fails to
   * COMPILE. That is a stronger gate than failing at startup, and strictly
   * stronger than being caught by a later audit.
   */
  scope: () => TenantScope | null;
  /** Compose the developer-platform snapshot from the existing ecosystem stores (injected → testable). */
  readState: () => DeveloperPlatformState;
}


export class DeveloperPlatformService {
  /**
   * One tenant-keyed cell holding the snapshot AND its projections.
   *
   * The projections are inside the cell rather than beside it because they
   * are derived from that snapshot: keeping the snapshot keyed while leaving
   * the derived values in a separate object would leak exactly the composed,
   * human-readable half — which is the half worth stealing.
   */
  private readonly cache: TenantMemo<DeveloperPlatformState>;

  constructor(private readonly deps: DeveloperPlatformServiceDeps) {
    this.cache = new TenantMemo<DeveloperPlatformState>('developer-platform-projections').bindScope(deps.scope);
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the stores. */
  invalidate(): void {
    this.cache.invalidate();
  }

  private state(): DeveloperPlatformState {
    return this.cache.state(() => this.deps.readState());
  }

  overview(): DeveloperPlatformOverview {
    const s = this.state();
    return this.cache.projection('overview', () => buildDeveloperPlatformOverview(s));
  }

  console(): DeveloperConsole {
    const s = this.state();
    return this.cache.projection('console', () => buildDeveloperConsole(s));
  }

  sdks(): SdkRegistry {
    const s = this.state();
    return this.cache.projection('sdks', () => buildSdkRegistry(s.sdkArtifacts));
  }

  apis(): ApiExplorer {
    const s = this.state();
    return this.cache.projection('apis', () => buildApiExplorer(s.publicApis, s.apiVersions));
  }

  templates(): TemplateRegistry {
    // `state()` first, like every sibling. It establishes the tenant's cell;
    // skipping it wrote this value into whichever cell happened to be current.
    // Harmless here — the registry is a static catalogue — and exactly the
    // habit that stops being harmless the day it reads a store.
    this.state();
    return this.cache.projection('templates', () => buildTemplateRegistry());
  }

  publishing(): PublishingConsole {
    const s = this.state();
    return this.cache.projection('publishing', () => buildPublishingConsole(s));
  }

  analytics(): DeveloperPlatformAnalytics {
    const s = this.state();
    return this.cache.projection('analytics', () => buildDeveloperAnalytics(s));
  }
}
