/**
 * P9 — Enterprise Marketplace service.
 *
 * Orchestrates the pure marketplace model over a catalog SOURCE that composes the EXISTING
 * ecosystem stores (listings + publishers + install state) — it holds no catalog of its own.
 * It evaluates org governance, builds trust reports + install plans, and — the key reuse —
 * ROUTES an approved worker install to the EXISTING P8.5 install service (injected), closing
 * the recon gap where the ecosystem marketplace recorded install state but never installed.
 * Non-worker types are cataloged + governed honestly (no importer exists yet). No new
 * installer, package format, PKI, search, or governance engine.
 */
import type {
  MarketplaceAnalytics,
  MarketplaceCatalogQuery,
  MarketplaceEntry,
  MarketplaceInstallResult,
  OrgMarketplacePolicy,
  PublisherProfile,
  TrustReport,
  InstallPlan,
  WorkerInstallResult,
  WorkerPackage,
} from '@neuropause/shared';
import type { OrgPolicyStore } from './orgPolicyStore';
import {
  buildTrustReport,
  categories,
  collections,
  computeAnalytics,
  evaluatePolicy,
  filterCatalog,
  isCompatible,
  resolveInstallPlan,
  toEntry,
  type DepNode,
  type EntryInput,
  type MarketplaceCollections,
} from './marketplaceModel';

/** Per-listing signals the model needs but that aren't on EntryInput (from the trust/version layer). */
export interface ListingMeta {
  signatureValid: boolean;
  signatureKeyId: string | null;
  engineRange: string;
}

export interface CatalogSource {
  entries: EntryInput[];
  publishers: PublisherProfile[];
  meta: Record<string, ListingMeta>;
  /** Count of installs later rolled back (for the rollback-rate metric). */
  rollbacks: number;
}

export interface MarketplaceServiceDeps {
  /** Compose the catalog from the existing ecosystem stores (injected, so this is testable). */
  source: () => CatalogSource;
  policy: OrgPolicyStore;
  /** Route an approved worker install to the EXISTING P8.5 install service. */
  installWorker: (pkg: WorkerPackage) => WorkerInstallResult;
  appVersion: string;
}

export class MarketplaceService {
  constructor(private readonly deps: MarketplaceServiceDeps) {}

  /**
   * Cache the projected entries + an id index, keyed on the SOURCE object IDENTITY. The
   * composition root memoizes the snapshot (rebuilt only on a backing-store change), so this
   * makes `entry`/`install`/`trustReport` O(1) lookups instead of re-projecting the whole
   * catalog on every call. When the snapshot is invalidated its identity changes and we
   * recompute exactly once.
   */
  private cache: { src: CatalogSource; entries: MarketplaceEntry[]; byId: Map<string, MarketplaceEntry> } | null = null;
  private computed(): { src: CatalogSource; entries: MarketplaceEntry[]; byId: Map<string, MarketplaceEntry> } {
    const src = this.deps.source();
    if (!this.cache || this.cache.src !== src) {
      const entries = src.entries.map(toEntry);
      this.cache = { src, entries, byId: new Map(entries.map((e) => [e.id, e])) };
    }
    return this.cache;
  }

  private entries(): MarketplaceEntry[] {
    return this.computed().entries;
  }

  catalog(query: MarketplaceCatalogQuery = {}): MarketplaceEntry[] {
    return filterCatalog(this.entries(), query);
  }

  collections(): MarketplaceCollections {
    return collections(this.entries());
  }

  categories(): { category: string; count: number }[] {
    return categories(this.entries());
  }

  entry(id: string): MarketplaceEntry | null {
    return this.computed().byId.get(id) ?? null;
  }

  publishers(): PublisherProfile[] {
    return [...this.deps.source().publishers].sort((a, b) => b.trustScore - a.trustScore || b.installs - a.installs);
  }

  trustReport(id: string): TrustReport | null {
    const { src, byId } = this.computed();
    const e = byId.get(id);
    if (!e) return null;
    const meta = src.meta[id] ?? { signatureValid: false, signatureKeyId: null, engineRange: '*' };
    const compatible = isCompatible(meta.engineRange, this.deps.appVersion);
    const verdict = evaluatePolicy(e, this.deps.policy.get(), { signatureValid: meta.signatureValid });
    return buildTrustReport(e, {
      signatureValid: meta.signatureValid,
      signatureKeyId: meta.signatureKeyId,
      scan: e.certified ? 'pass' : 'none',
      compatible,
      compatibilityNote: compatible ? null : `Requires app ${meta.engineRange}`,
      verdict,
    });
  }

  installPlan(id: string): InstallPlan {
    const { src, entries } = this.computed();
    const nodes = new Map<string, DepNode>();
    for (const e of entries) {
      const range = src.meta[e.id]?.engineRange ?? '*';
      nodes.set(e.id, { dependencies: e.dependencies, compatible: isCompatible(range, this.deps.appVersion) });
    }
    return resolveInstallPlan(id, nodes);
  }

  analytics(): MarketplaceAnalytics {
    const { src, entries } = this.computed();
    return computeAnalytics(
      entries,
      src.publishers.map((p) => ({ id: p.id, name: p.name, installs: p.installs, tier: p.tier })),
      src.rollbacks,
    );
  }

  policyGet(): OrgMarketplacePolicy {
    return this.deps.policy.get();
  }

  policySet(next: Omit<OrgMarketplacePolicy, 'updatedAt'>): OrgMarketplacePolicy {
    return this.deps.policy.set(next);
  }

  /**
   * Governed install. Evaluates org policy (deny/require_approval/allow), then — when allowed
   * and the package is a worker — routes the signed `WorkerPackage` to the EXISTING installer.
   * Other types are cataloged + governed (no in-app importer yet). Never bypasses policy.
   */
  install(listingId: string, pkg?: WorkerPackage): MarketplaceInstallResult {
    const { src, byId } = this.computed();
    const e = byId.get(listingId);
    if (!e) return { ok: false, decision: 'deny', routed: false, message: 'Listing not found', errors: ['not_found'] };

    // Evaluate governance with cryptographic signature VALIDITY (not mere presence) when the
    // trust layer supplies it, so a present-but-invalid signature can't satisfy requireSignature.
    const verdict = evaluatePolicy(e, this.deps.policy.get(), { signatureValid: src.meta[listingId]?.signatureValid });
    if (verdict.decision === 'deny') {
      return { ok: false, decision: 'deny', routed: false, message: verdict.reasons[0] ?? 'Blocked by org policy', errors: verdict.reasons };
    }
    if (verdict.decision === 'require_approval') {
      return { ok: false, decision: 'require_approval', routed: false, message: 'Install requires organization approval', errors: [] };
    }

    // Allowed → route by capability.
    if (e.capability === 'installable' && e.packageType === 'worker') {
      // With the signed package in hand, route to the EXISTING P8.5 worker installer.
      if (pkg) {
        const r = this.deps.installWorker(pkg);
        return {
          ok: r.ok,
          decision: 'allow',
          routed: true,
          message: r.ok ? `Installed "${e.name}"` : r.errors[0] ?? 'Install failed',
          errors: r.errors,
        };
      }
      // Approved, but the signed package isn't carried on this request. This is a routing
      // HAND-OFF, not a rejection: the org has authorized the install, and the signed worker
      // package is applied from the Workforce Center (the P8.5 install surface).
      return {
        ok: true,
        decision: 'allow',
        routed: false,
        message: `"${e.name}" is approved — install the signed worker package from the Workforce Center`,
        errors: [],
      };
    }

    return {
      ok: true,
      decision: 'allow',
      routed: false,
      message: `"${e.name}" is approved (${e.capability}); no in-app installer exists for this type yet`,
      errors: [],
    };
  }
}
