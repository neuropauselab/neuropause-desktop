/**
 * Module 9 — Marketplace Runtime. An enterprise marketplace for packages / plugins /
 * connectors / workflows / AI agents / templates. PUBLISHING ONLY: publish a listing, search
 * it, and install it (which copies the listing descriptor to an org and increments the
 * install count). Live cross-org DISTRIBUTION over a network is infra-pending — install here
 * is an in-process copy, never a real download.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { FederationGovernance } from './governance';
import type { MarketplaceListing } from './types';
import type { MarketplaceKind } from './constants';

export interface InstallRecord {
  listingId: string;
  orgId: string;
  installedAt: number;
  note: string;
}

export class MarketplaceRuntime {
  private readonly listings = new Map<string, MarketplaceListing>();
  private readonly installs: InstallRecord[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly governance: FederationGovernance,
  ) {}

  async publish(input: { kind: MarketplaceKind; name: string; publisherOrg: string; version?: string; description?: string; payload?: Record<string, unknown> }): Promise<MarketplaceListing> {
    const listing: MarketplaceListing = { id: randomId('mkt'), kind: input.kind, name: input.name, publisherOrg: input.publisherOrg, version: input.version ?? '1.0.0', description: input.description ?? '', payload: input.payload ?? {}, publishedAt: this.clock.now(), installs: 0 };
    this.listings.set(listing.id, listing);
    await this.governance.record({ federationId: '_marketplace', actor: input.publisherOrg, operation: 'marketplace.publish', targetId: listing.id, evidence: 'live-verified', detail: `${input.kind}:${input.name}` });
    return listing;
  }

  search(query: string): MarketplaceListing[] {
    const q = query.toLowerCase();
    return [...this.listings.values()].filter((l) => l.name.toLowerCase().includes(q) || l.kind.toLowerCase().includes(q) || l.description.toLowerCase().includes(q));
  }
  get(id: string): MarketplaceListing | undefined {
    return this.listings.get(id);
  }
  list(kind?: MarketplaceKind): MarketplaceListing[] {
    const all = [...this.listings.values()];
    return kind ? all.filter((l) => l.kind === kind) : all;
  }

  /** Install = copy the listing descriptor into an org (in-process). Live distribution is infra-pending. */
  async install(listingId: string, orgId: string): Promise<InstallRecord> {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`unknown listing '${listingId}'`);
    listing.installs += 1;
    const record: InstallRecord = { listingId, orgId, installedAt: this.clock.now(), note: 'in-process copy — live marketplace distribution is infra-pending' };
    this.installs.push(record);
    await this.governance.record({ federationId: '_marketplace', actor: orgId, operation: 'marketplace.install', targetId: listingId, evidence: 'live-verified', detail: record.note });
    return record;
  }

  installsFor(orgId: string): InstallRecord[] {
    return this.installs.filter((i) => i.orgId === orgId);
  }
  count(): number {
    return this.listings.size;
  }
}
