/**
 * P10 — Federation Platform service.
 *
 * Orchestrates the pure model over a memoized snapshot composed from the EXISTING federation
 * stores (peers/trust/shares, the signed exchange, and cross-org governance) via injected
 * readers. It caches BOTH the composed snapshot AND each projection keyed on that snapshot, so
 * repeated reads are genuine O(1) cache hits; the composition root invalidates on any backing
 * store change. Also adapts federation discovery into the common Enterprise Search hit shape
 * (one search engine, reused) — private-safe, so cross-org private artifacts never leak through
 * the broadly-reachable Enterprise Search channel.
 */
import type {
  DelegatedApproval,
  EnterpriseSearchHit,
  ExchangeArtifact,
  FederatedOrg,
  FederationAnalytics,
  FederationGraph,
  FederationOverview,
  FederationSearchHit,
  FederationSearchKind,
  FederationSummary,
  FederationTimelineEntry,
  FedAuditEntry,
  FedPolicy,
  GlobalGovSummary,
  MarketplaceScopeSummary,
  OrgDirectoryEntry,
  OrgInvitation,
  SharedResource,
  TrustRelationship,
} from '@neuropause/shared';
import {
  buildFederationAnalytics,
  buildFederationGraph,
  buildFederationOverview,
  buildFederationTimeline,
  buildOrgDirectory,
  searchFederation,
  type FederationState,
} from './federationModel';
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../tenancy/tenantMemo';

/** Cap on the timeline returned over IPC (newest-first), bounding the payload at scale. */
const TIMELINE_CAP = 500;

/** Live readers over the existing federation stores (injected, so the service unit-tests). */
export interface FederationReaders {
  /**
   * P13C N10 — FUNCTIONS, not captured strings.
   *
   * These were `string`, resolved once at composition. That made a per-call
   * reader impossible and froze the platform's identity at boot, so it could
   * not follow a tenant switch. `homeOrgId` is not a label: `federationModel`
   * compares it against `artifact.publisherOrg` to decide which PRIVATE
   * exchange artifacts are visible, so a stale value shows the wrong tenant's.
   */
  homeOrgId: () => string;
  homeOrgName: () => string;
  orgs: () => FederatedOrg[];
  invitations: () => OrgInvitation[];
  trust: () => TrustRelationship[];
  shared: () => SharedResource[];
  artifacts: () => ExchangeArtifact[];
  policies: () => FedPolicy[];
  approvals: () => DelegatedApproval[];
  audit: () => FedAuditEntry[];
  summary: () => FederationSummary;
  scopes: () => MarketplaceScopeSummary[];
  govSummary: () => GlobalGovSummary;
}


export class FederationPlatformService {
  /**
   * P13C ROUND 5 — F7. TENANT-KEYED, and it was the last keyless composed cache
   * over federation data in the application.
   *
   * `private snapshot` with NO key and NO TTL, protected only by an
   * `onWorkspaceSwitch` listener. Three consequences that listener cannot cover:
   * signing out does not invalidate; an organization switch that does not commit
   * a workspace announces nothing (the enterprise root only announces
   * `if (ws)`); and with no expiry a stale snapshot persists indefinitely rather
   * than for a few seconds.
   *
   * Every field it caches is tenant-derived, including `homeOrgId` — which the
   * model then uses to decide which artifacts are private. A stale
   * `homeOrgId` is not a stale label; it is the input to a visibility check.
   *
   * The TTL below is FRESHNESS ONLY. The key is the boundary.
   */
  private readonly cache: TenantMemo<FederationState>;

  constructor(
    private readonly readers: FederationReaders,
    scope: () => TenantScope | null,
  ) {
    this.cache = new TenantMemo<FederationState>('federation-platform-projections', { ttlMs: 3000 }).bindScope(scope);
  }

  /** Drop the memoized snapshot AND projections; the next read recomposes from the stores. */
  invalidate(): void {
    this.cache.invalidate();
  }

  private state(): FederationState {
    return this.cache.state(() => {
      const r = this.readers;
      return {
        homeOrgId: r.homeOrgId(),
        homeOrgName: r.homeOrgName(),
        orgs: r.orgs(),
        invitations: r.invitations(),
        trust: r.trust(),
        shared: r.shared(),
        artifacts: r.artifacts(),
        policies: r.policies(),
        approvals: r.approvals(),
        audit: r.audit(),
        summary: r.summary(),
        scopes: r.scopes(),
        govSummary: r.govSummary(),
      };
    });
  }

  graph(): FederationGraph {
    const s = this.state();
    return this.cache.projection('graph', () => buildFederationGraph(s));
  }

  timeline(): FederationTimelineEntry[] {
    const s = this.state();
    return this.cache.projection('timeline', () => buildFederationTimeline(s).slice(0, TIMELINE_CAP));
  }

  directory(): OrgDirectoryEntry[] {
    const s = this.state();
    return this.cache.projection('directory', () => buildOrgDirectory(s));
  }

  analytics(): FederationAnalytics {
    const s = this.state();
    return this.cache.projection('analytics', () => buildFederationAnalytics(s));
  }

  overview(): FederationOverview {
    const s = this.state();
    return this.cache.projection('overview', () => buildFederationOverview(s));
  }

  search(text: string, kinds?: FederationSearchKind[], limit?: number): FederationSearchHit[] {
    return searchFederation(this.state(), text, { kinds, limit });
  }

  /**
   * Enterprise Search adapter: federation discovery mapped into the common hit shape. Passes
   * `includePrivate: false` so NO private-scope artifact is surfaced through Enterprise Search
   * (the gated federation:read Federation Center is the surface for the home org's private items).
   */
  searchHits(text: string, limit: number): EnterpriseSearchHit[] {
    return searchFederation(this.state(), text, { limit, includePrivate: false }).map(
      (h): EnterpriseSearchHit => ({
        source: 'federation',
        id: `${h.kind}:${h.id}`,
        kind: h.kind,
        title: h.title,
        snippet: h.subtitle,
        score: h.score,
        connectorId: null,
        timestamp: null,
        url: null,
      }),
    );
  }
}
