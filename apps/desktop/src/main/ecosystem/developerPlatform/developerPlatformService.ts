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

export interface DeveloperPlatformServiceDeps {
  /** Compose the developer-platform snapshot from the existing ecosystem stores (injected → testable). */
  readState: () => DeveloperPlatformState;
}

interface ProjectionMemo {
  overview?: DeveloperPlatformOverview;
  console?: DeveloperConsole;
  sdks?: SdkRegistry;
  apis?: ApiExplorer;
  templates?: TemplateRegistry;
  publishing?: PublishingConsole;
  analytics?: DeveloperPlatformAnalytics;
}

export class DeveloperPlatformService {
  private snapshot: DeveloperPlatformState | null = null;
  private memo: ProjectionMemo = {};

  constructor(private readonly deps: DeveloperPlatformServiceDeps) {}

  /** Drop the memoized snapshot AND projections; the next read recomposes from the stores. */
  invalidate(): void {
    this.snapshot = null;
    this.memo = {};
  }

  private state(): DeveloperPlatformState {
    if (!this.snapshot) {
      this.snapshot = this.deps.readState();
      this.memo = {};
    }
    return this.snapshot;
  }

  overview(): DeveloperPlatformOverview {
    const s = this.state();
    return (this.memo.overview ??= buildDeveloperPlatformOverview(s));
  }

  console(): DeveloperConsole {
    const s = this.state();
    return (this.memo.console ??= buildDeveloperConsole(s));
  }

  sdks(): SdkRegistry {
    const s = this.state();
    return (this.memo.sdks ??= buildSdkRegistry(s.sdkArtifacts));
  }

  apis(): ApiExplorer {
    const s = this.state();
    return (this.memo.apis ??= buildApiExplorer(s.publicApis, s.apiVersions));
  }

  templates(): TemplateRegistry {
    return (this.memo.templates ??= buildTemplateRegistry());
  }

  publishing(): PublishingConsole {
    const s = this.state();
    return (this.memo.publishing ??= buildPublishingConsole(s));
  }

  analytics(): DeveloperPlatformAnalytics {
    const s = this.state();
    return (this.memo.analytics ??= buildDeveloperAnalytics(s));
  }
}
