/**
 * P9 — Enterprise Marketplace composition root.
 *
 * Builds the catalog SOURCE by composing the EXISTING ecosystem stores (marketplace
 * listings + developer publishers + org installs) — no new catalog store. Verifies each
 * version against the ecosystem signing key (reuses `verifyManifest`), derives publisher
 * trust, and wires the service's install routing to the injected P8.5 worker installer.
 * Exposes RBAC-gated IPC (reads → marketplace:read, policy → marketplace:manage, install →
 * workforce:manage — the same authority as a direct worker install, so no escalation).
 */
import { createPublicKey, type KeyObject } from 'node:crypto';
import type {
  EnterprisePermission,
  IpcChannelName,
  ListingVersion,
  MarketplaceListing,
  PublisherProfile,
  WorkerInstallResult,
  WorkerPackage,
  MarketplaceCatalogRequest as TMarketplaceCatalogRequest,
  MarketplaceListingRequest as TMarketplaceListingRequest,
  MarketplacePolicySetRequest as TMarketplacePolicySetRequest,
  MarketplaceInstallRequest as TMarketplaceInstallRequest,
} from '@neuropause/shared';
import {
  EmptyRequest,
  IpcChannel,
  MarketplaceCatalogRequest,
  MarketplaceInstallRequest,
  MarketplaceListingRequest,
  MarketplacePolicySetRequest,
} from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef, SecureHandlerDefFor } from '../ipc/secureBridge';
import { ORG_ID } from '../enterprise/org/seed';
import { marketplaceStore } from '../ecosystem/marketplace/marketplaceInstance';
import { developerStore } from '../ecosystem/developer/developerInstance';
import { installsStore } from '../ecosystem/exchange/installsInstance';
import { verifyManifest } from '../ecosystem/marketplace/pipeline';
import { orgPolicyStore } from './instance';
import { publisherTier, publisherTrust, type EntryInput } from './marketplaceModel';
import { MarketplaceService, type CatalogSource, type ListingMeta } from './marketplaceService';

const log = createLogger('marketplace');

export interface MarketplaceSubsystemDeps {
  broadcast: IpcBroadcaster;
  appVersion: string;
  /** Route an approved worker install to the EXISTING P8.5 install service. */
  installWorker: (pkg: WorkerPackage) => WorkerInstallResult;
}

export interface MarketplaceSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
}

/**
 * Compose the catalog source from the existing ecosystem stores. Buckets ALL versions in
 * ONE pass (`allVersions()`) instead of an O(N) `detail()` per listing, so composition is
 * O(N+V). The result is memoized by `initMarketplace` and rebuilt only on a store 'changed'.
 */
function buildSource(): CatalogSource {
  const listings = marketplaceStore.list();
  const versionsByListing = new Map<string, ListingVersion[]>();
  for (const v of marketplaceStore.allVersions()) {
    const arr = versionsByListing.get(v.listingId) ?? [];
    arr.push(v);
    versionsByListing.set(v.listingId, arr);
  }
  const installByListing = new Map<string, EntryInput['installStatus']>();
  for (const inst of installsStore.forOrg(ORG_ID)) installByListing.set(inst.listingId, inst.status);

  const orgKeyId = marketplaceStore.signingKeyId();
  let pubKey: KeyObject | null = null;
  try {
    pubKey = createPublicKey(marketplaceStore.publicKeyPem());
  } catch {
    pubKey = null;
  }
  const defaultDevId = developerStore.defaultDeveloper().id;

  const byDev = new Map<string, MarketplaceListing[]>();
  for (const l of listings) {
    const arr = byDev.get(l.developerId) ?? [];
    arr.push(l);
    byDev.set(l.developerId, arr);
  }

  const entries: EntryInput[] = [];
  const meta: Record<string, ListingMeta> = {};
  for (const l of listings) {
    const versions = versionsByListing.get(l.id) ?? [];
    const version = versions.find((v) => v.id === l.currentVersionId) ?? versions.find((v) => v.status === 'published') ?? null;
    const dev = developerStore.developer(l.developerId);
    const devListings = byDev.get(l.developerId) ?? [];
    const signed = version?.signature != null;
    entries.push({
      id: l.id,
      slug: l.slug,
      name: l.name,
      summary: l.summary,
      kind: l.kind,
      metadata: version?.manifest.metadata ?? {},
      category: l.category,
      certified: l.certified,
      version: version?.version ?? '0.0.0',
      signed,
      scan: version?.scan?.status ?? (l.certified ? 'pass' : 'none'),
      rating: l.ratingAvg,
      ratingCount: l.ratingCount,
      installs: l.installs,
      dependencies: version?.manifest.dependencies ?? [],
      updatedAt: l.updatedAt,
      publisher: {
        id: l.developerId,
        name: dev?.name ?? l.developerId,
        verified: devListings.some((x) => x.certified),
        official: l.developerId === defaultDevId,
        listings: devListings.length,
        installs: devListings.reduce((n, x) => n + x.installs, 0),
        // A publisher's key is a property of the publisher, not one listing — keep it
        // consistent with the Publishers view so trust doesn't differ per listing.
        keyId: orgKeyId,
        verifiedAt: null,
      },
      installStatus: installByListing.get(l.id) ?? 'not_installed',
    });
    const signatureValid = Boolean(version?.signature && pubKey && verifyManifest(version.manifest, version.signature, pubKey));
    meta[l.id] = {
      signatureValid,
      signatureKeyId: version?.signature?.keyId ?? null,
      engineRange: version?.manifest.metadata.engine ?? '*',
    };
  }

  const publishers: PublisherProfile[] = [...byDev.entries()].map(([devId, ls]) => {
    const dev = developerStore.developer(devId);
    const signals = {
      verified: ls.some((x) => x.certified),
      official: devId === defaultDevId,
      installs: ls.reduce((n, x) => n + x.installs, 0),
      keyId: orgKeyId,
    };
    return {
      id: devId,
      name: dev?.name ?? devId,
      tier: publisherTier(signals),
      trustScore: publisherTrust(signals),
      keyId: orgKeyId,
      verifiedAt: null,
      listings: ls.length,
      installs: signals.installs,
    };
  });

  return { entries, publishers, meta, rollbacks: 0 };
}

const READ: EnterprisePermission = 'marketplace:read';
const MANAGE: EnterprisePermission = 'marketplace:manage';
// Install routes to the worker installer → require the SAME authority as a direct worker
// install (no privilege escalation via the marketplace).
const INSTALL: EnterprisePermission = 'workforce:manage';

/**
 * The seven read routes differ only in channel, schema and body, so they are built by
 * this helper rather than repeating `requireAuth`/`permission` seven times — one place
 * decides that a marketplace read is authenticated and gated on `marketplace:read`.
 *
 * A7 — generic over the channel. It used to take `channel: string` and cast it back to
 * the channel union, which discarded exactly the information the response contract
 * needs: with `C` bound, `handler` is checked against what THAT channel promises the
 * renderer, and the cast is gone.
 */
function read<C extends IpcChannelName>(
  channel: C,
  schema: SecureHandlerDefFor<C>['schema'],
  handler: SecureHandlerDefFor<C>['handler'],
): SecureHandlerDefFor<C> {
  return { channel, schema, handler, requireAuth: true, permission: READ };
}

export async function initMarketplace(deps: MarketplaceSubsystemDeps): Promise<MarketplaceSubsystem> {
  await orgPolicyStore.load();

  // Memoize the composed catalog snapshot; rebuild only when a backing store changes, so
  // reads are O(1) cache hits (a 100k-listing catalog composes once per change, not per call).
  let snapshot: CatalogSource | null = null;
  const source = (): CatalogSource => {
    if (!snapshot) snapshot = buildSource();
    return snapshot;
  };
  const service = new MarketplaceService({
    source,
    policy: orgPolicyStore,
    installWorker: deps.installWorker,
    appVersion: deps.appVersion,
  });

  const onChange = (): void => {
    snapshot = null; // invalidate → next read recomposes
    deps.broadcast(IpcChannel.MarketplaceEventBroadcast, { at: Date.now() });
  };
  marketplaceStore.on('changed', onChange);
  installsStore.on('changed', onChange);
  orgPolicyStore.on('changed', onChange);

  const handlers: SecureHandlerDef[] = [
    read(IpcChannel.MarketplaceCatalog, MarketplaceCatalogRequest, (p) => service.catalog(p as TMarketplaceCatalogRequest)),
    read(IpcChannel.MarketplaceEntry, MarketplaceListingRequest, (p) => service.entry((p as TMarketplaceListingRequest).listingId)),
    read(IpcChannel.MarketplacePublishers, EmptyRequest, () => service.publishers()),
    read(IpcChannel.MarketplaceTrust, MarketplaceListingRequest, (p) => service.trustReport((p as TMarketplaceListingRequest).listingId)),
    read(IpcChannel.MarketplacePlan, MarketplaceListingRequest, (p) => service.installPlan((p as TMarketplaceListingRequest).listingId)),
    read(IpcChannel.MarketplaceAnalytics, EmptyRequest, () => service.analytics()),
    read(IpcChannel.MarketplacePolicyGet, EmptyRequest, () => service.policyGet()),
    {
      channel: IpcChannel.MarketplacePolicySet,
      schema: MarketplacePolicySetRequest,
      requireAuth: true,
      permission: MANAGE,
      audit: true,
      handler: (p) => service.policySet(p as TMarketplacePolicySetRequest),
    },
    {
      channel: IpcChannel.MarketplaceInstall,
      schema: MarketplaceInstallRequest,
      requireAuth: true,
      permission: INSTALL,
      audit: true,
      handler: (p) => {
        const r = p as TMarketplaceInstallRequest;
        return service.install(r.listingId, r.package);
      },
    },
  ];

  const dispose = (): void => {
    marketplaceStore.off('changed', onChange);
    installsStore.off('changed', onChange);
    orgPolicyStore.off('changed', onChange);
  };

  log.info('Enterprise Marketplace ready', { listings: marketplaceStore.list().length });
  return { handlers, dispose };
}
