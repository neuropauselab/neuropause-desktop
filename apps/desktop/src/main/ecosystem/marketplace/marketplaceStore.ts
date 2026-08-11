/**
 * The Marketplace store: listings, their versions, and the submission audit
 * trail — plus the organization's Ed25519 signing key. It drives the full
 * lifecycle (submit → scan → sign → review → publish → rollback) using the pure
 * pipeline. Seeded examples are run through the same scan + sign path, so every
 * published version carries a real signature. Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import {
  randomUUID,
  createHash,
  generateKeyPairSync,
  createPublicKey,
  createPrivateKey,
  type KeyObject,
} from 'node:crypto';
import type {
  ListingDetail,
  ListingKind,
  ListingManifest,
  ListingPricing,
  ListingStatus,
  ListingVersion,
  MarketplaceListing,
  MarketplaceStats,
  ReviewDecision,
  ReviewRecord,
  SubmissionEvent,
} from '@neuropause/shared';
import { createLogger } from '../../logger';
import { securityScan, signManifest } from './pipeline';
import { declareStoreScope } from '../../tenancy/storeScope';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'ecosystem-marketplace',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention: "Event log capped PER PUBLISHER as of Round 8. It was an install-wide slice, so one publisher's activity evicted another's submission trail.",
  reason: "ROUND 8 FINDING: no seam, no orgId, and developerId was a constant — while EcosystemShareWorker writes a tenant's AI worker name and first goal into a listing every tenant could read, and events carry the signed-in actor's name and email.",
});

const log = createLogger('marketplace');
const EVENT_CAP = 5000;

interface MarketFile {
  listings: MarketplaceListing[];
  versions: ListingVersion[];
  events: SubmissionEvent[];
  publicKeyPem: string;
  privateKeyPem: string;
  seeded: boolean;
}

export interface SeedListing {
  kind: ListingKind;
  slug: string;
  name: string;
  summary: string;
  category: string;
  pricing: ListingPricing;
  certified: boolean;
  manifest: ListingManifest;
  changelog: string;
}

export class MarketplaceStore extends EventEmitter {
  /** P13C Round 8 — the publisher boundary. See `bindScope`. */
  private readonly tenancy = new TenantOwnership('ecosystem-marketplace');

  private listings = new Map<string, MarketplaceListing>();
  private versions = new Map<string, ListingVersion>();
  private events: SubmissionEvent[] = [];
  private publicKey!: KeyObject;
  private privateKey!: KeyObject;
  private keyId = '';
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly developerId: string,
    private readonly seeds: SeedListing[],
  ) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<MarketFile>;
      if (data.publicKeyPem && data.privateKeyPem) {
        this.publicKey = createPublicKey(data.publicKeyPem);
        this.privateKey = createPrivateKey(data.privateKeyPem);
      } else {
        this.generateKeys();
      }
      for (const l of data.listings ?? []) if (l?.id) this.listings.set(l.id, l);
      for (const v of data.versions ?? []) if (v?.id) this.versions.set(v.id, v);
      this.events = Array.isArray(data.events) ? data.events : [];
      if (!data.seeded || this.listings.size === 0) this.applySeed();
    } catch {
      this.generateKeys();
      this.applySeed();
    }
    this.computeKeyId();
    this.loaded = true;
    log.info('Marketplace ready', { listings: this.listings.size, versions: this.versions.size, keyId: this.keyId });
  }

  private generateKeys(): void {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }
  private computeKeyId(): void {
    const pem = this.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    this.keyId = `npsign_${createHash('sha256').update(pem).digest('hex').slice(0, 16)}`;
  }

  signingKeyId(): string {
    return this.keyId;
  }
  publicKeyPem(): string {
    return this.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  private applySeed(): void {
    this.computeKeyId();
    for (const s of this.seeds) {
      if ([...this.listings.values()].some((l) => l.slug === s.slug)) continue;
      const listing = this.createListing({
        kind: s.kind,
        slug: s.slug,
        name: s.name,
        summary: s.summary,
        category: s.category,
        pricing: s.pricing,
        certified: s.certified,
      });
      const version = this.addVersion(listing.id, s.manifest, s.changelog);
      if (version) {
        this.submit(version.id, 'seed');
        const v = this.versions.get(version.id);
        if (v && v.status === 'in_review') {
          this.review(v.id, 'approved', 'neuropause-review', 'Seed example — auto-approved.');
          this.publish(v.id, 'seed');
        }
      }
    }
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const file: MarketFile = {
      listings: [...this.listings.values()],
      versions: [...this.versions.values()],
      events: this.events,
      publicKeyPem: this.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: this.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      seeded: true,
    };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drain();
  }
  private async drain(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Marketplace persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /**
   * Bind the publisher boundary. P13C ROUND 8.
   *
   * WHAT IS AND IS NOT A LEAK HERE, because a marketplace is the one place where
   * cross-tenant visibility is the PRODUCT:
   *
   *   PUBLISHED listings   visible to everyone. That is what publishing means, and
   *                        the publisher chose it. Not scoped, deliberately.
   *   DRAFT / IN-REVIEW    visible to the PUBLISHER only. A draft is work in
   *                        progress — including, via EcosystemShareWorker, a
   *                        tenant's AI worker name and first goal, which is that
   *                        tenant's operational detail until they publish it.
   *   THE EVENT TRAIL      the publisher's only. Events carry the signed-in
   *                        actor's display name and email and the review history,
   *                        which is nobody else's business even for a published
   *                        listing.
   *
   * Unbound denies the scoped halves and leaves published listings readable, which
   * is the correct fail-closed shape for a catalogue: a signed-out or unresolved
   * caller sees the storefront and nothing behind it.
   */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }

  /** The caller's organization, or null. */
  private publisher(): string | null {
    return this.tenancy.scopeOrDeny()?.tenantId ?? null;
  }

  /* ── reads ── */

  /**
   * Published listings, plus THE CALLER'S OWN drafts.
   *
   * P13C Round 8. This returned every listing in every state, so one tenant's
   * unpublished submissions — and the worker names inside them — were readable by
   * every other tenant.
   */
  list(): MarketplaceListing[] {
    const mine = this.publisher();
    return [...this.listings.values()]
      .filter((l) => l.status === 'published' || (mine !== null && l.publisherOrgId === mine))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  /** P9 — all versions in one pass (lets the marketplace bucket by listing without O(N) detail() calls). */
  allVersions(): ListingVersion[] {
    return [...this.versions.values()];
  }
  /**
   * The detail view of a listing already in hand. `detail(id)` is the lookup form and
   * must admit `null` for an id that names nothing; this form cannot fail, so a caller
   * holding a listing it just created does not have to handle an impossible miss.
   */
  detailFor(listing: MarketplaceListing): ListingDetail {
    return { listing, versions: [...this.versions.values()].filter((v) => v.listingId === listing.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }
  /** One listing, if it is published or the caller published it. Was a bare id. */
  detail(id: string): ListingDetail | null {
    const listing = this.listings.get(id);
    if (!listing) return null;
    const mine = this.publisher();
    if (listing.status !== 'published' && (mine === null || listing.publisherOrgId !== mine)) return null;
    return this.detailFor(listing);
  }
  /** The submission trail for a listing the CALLER published. */
  eventsFor(listingId: string, limit = 50): SubmissionEvent[] {
    if (this.detail(listingId) === null) return [];
    const mine = this.publisher();
    const listing = this.listings.get(listingId);
    if (mine === null || listing?.publisherOrgId !== mine) return [];
    return this.events.filter((e) => e.listingId === listingId).slice(-limit).reverse();
  }

  /**
   * The CALLER'S OWN submission trail.
   *
   * Events carry the acting person's display name and email. An install-wide feed
   * of them was a roster of who at which organization submitted what, and when.
   */
  recentEvents(limit = 50): SubmissionEvent[] {
    const mine = this.publisher();
    if (mine === null) return [];
    const ownListings = new Set(
      [...this.listings.values()].filter((l) => l.publisherOrgId === mine).map((l) => l.id),
    );
    return this.events
      .filter((e) => e.listingId !== null && ownListings.has(e.listingId))
      .slice(-limit)
      .reverse();
  }

  stats(): MarketplaceStats {
    const all = [...this.listings.values()];
    const byKind: Record<string, number> = {};
    for (const l of all) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
    const pendingReview = [...this.versions.values()].filter((v) => v.status === 'in_review').length;
    return {
      totalListings: all.length,
      published: all.filter((l) => l.status === 'published').length,
      inReview: all.filter((l) => l.status === 'in_review').length,
      draft: all.filter((l) => l.status === 'draft').length,
      byKind,
      totalInstalls: all.reduce((n, l) => n + l.installs, 0),
      pendingReview,
    };
  }

  /* ── lifecycle ── */

  createListing(input: { kind: ListingKind; slug: string; name: string; summary: string; category: string; pricing: ListingPricing; certified?: boolean }): MarketplaceListing {
    const now = new Date().toISOString();
    const listing: MarketplaceListing = {
      id: `lst_${randomUUID()}`,
      kind: input.kind,
      slug: input.slug,
      name: input.name,
      summary: input.summary,
      developerId: this.developerId,
      // P13C Round 8 — the publisher, stamped from the resolver. `developerId` is a
      // constant (`dev-owner`), so it never identified anybody.
      publisherOrgId: this.publisher(),
      category: input.category,
      pricing: input.pricing,
      status: 'draft',
      currentVersionId: null,
      latestVersionId: null,
      installs: 0,
      ratingAvg: 0,
      ratingCount: 0,
      certified: input.certified ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.listings.set(listing.id, listing);
    this.schedulePersist();
    this.emit('changed');
    return listing;
  }

  addVersion(listingId: string, manifest: ListingManifest, changelog: string): ListingVersion | null {
    const listing = this.listings.get(listingId);
    if (!listing) return null;
    const now = new Date().toISOString();
    const version: ListingVersion = {
      id: `ver_${randomUUID()}`,
      listingId,
      version: manifest.version,
      status: 'draft',
      manifest,
      changelog,
      scan: null,
      signature: null,
      review: null,
      createdAt: now,
      publishedAt: null,
    };
    this.versions.set(version.id, version);
    this.listings.set(listingId, { ...listing, latestVersionId: version.id, status: 'draft', updatedAt: now });
    this.event(listingId, version.id, 'version.created', 'developer', `Created version ${manifest.version}`);
    this.schedulePersist();
    this.emit('changed');
    return version;
  }

  /** Submit → scan → (sign) → in_review, or reject on scan failure. */
  submit(versionId: string, actor: string): ListingVersion | null {
    const v = this.versions.get(versionId);
    if (!v) return null;
    if (!['draft', 'rejected', 'rolled_back'].includes(v.status)) return v;

    this.setVersion(versionId, { status: 'scanning' });
    this.event(v.listingId, versionId, 'submitted', actor, `Submitted version ${v.version} for review`);

    const scan = securityScan(v.manifest);
    this.event(v.listingId, versionId, `scan.${scan.status}`, 'scanner', `Security scan ${scan.status} (${scan.findings.length} finding(s))`);

    if (scan.status === 'fail') {
      const review: ReviewRecord = { decision: 'rejected', reviewer: 'scanner', notes: 'Automatically rejected: security scan failed.', decidedAt: new Date().toISOString() };
      this.setVersion(versionId, { status: 'rejected', scan, review });
      this.setListingStatus(v.listingId, 'rejected');
      this.emit('changed');
      return this.versions.get(versionId) ?? null;
    }

    this.setVersion(versionId, { status: 'signing', scan });
    const signature = signManifest(v.manifest, this.privateKey, this.keyId);
    this.event(v.listingId, versionId, 'signed', 'signer', `Signed with ${this.keyId}`);
    this.setVersion(versionId, { status: 'in_review', signature });
    this.setListingStatus(v.listingId, 'in_review');
    this.schedulePersist();
    this.emit('changed');
    return this.versions.get(versionId) ?? null;
  }

  review(versionId: string, decision: ReviewDecision, reviewer: string, notes: string): ListingVersion | null {
    const v = this.versions.get(versionId);
    if (!v || v.status !== 'in_review') return v ?? null;
    const review: ReviewRecord = { decision, reviewer, notes, decidedAt: new Date().toISOString() };
    const status: ListingStatus = decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'draft';
    this.setVersion(versionId, { status, review });
    this.setListingStatus(v.listingId, status);
    this.event(v.listingId, versionId, `review.${decision}`, reviewer, notes || decision);
    this.schedulePersist();
    this.emit('changed');
    return this.versions.get(versionId) ?? null;
  }

  publish(versionId: string, actor: string): ListingVersion | null {
    const v = this.versions.get(versionId);
    if (!v || v.status !== 'approved') return v ?? null;
    const listing = this.listings.get(v.listingId);
    if (!listing) return null;
    const now = new Date().toISOString();
    this.setVersion(versionId, { status: 'published', publishedAt: now });
    this.listings.set(listing.id, { ...listing, status: 'published', currentVersionId: versionId, updatedAt: now });
    this.event(listing.id, versionId, 'published', actor, `Published version ${v.version}`);
    this.schedulePersist();
    this.emit('changed');
    return this.versions.get(versionId) ?? null;
  }

  /** Roll back the current published version to the previous published one. */
  rollback(listingId: string, actor: string): MarketplaceListing | null {
    const listing = this.listings.get(listingId);
    if (!listing || !listing.currentVersionId) return listing ?? null;
    const current = this.versions.get(listing.currentVersionId);
    const published = [...this.versions.values()]
      .filter((v) => v.listingId === listingId && v.status === 'published' && v.id !== listing.currentVersionId && v.publishedAt)
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    const previous = published[0] ?? null;
    if (current) this.setVersion(current.id, { status: 'rolled_back' });
    const now = new Date().toISOString();
    this.listings.set(listingId, { ...listing, currentVersionId: previous?.id ?? null, status: previous ? 'published' : 'draft', updatedAt: now });
    this.event(listingId, current?.id ?? '', 'rolled_back', actor, previous ? `Rolled back to ${previous.version}` : 'Rolled back; no prior version');
    this.schedulePersist();
    this.emit('changed');
    return this.listings.get(listingId) ?? null;
  }

  install(listingId: string): MarketplaceListing | null {
    const l = this.listings.get(listingId);
    if (!l) return null;
    const next = { ...l, installs: l.installs + 1 };
    this.listings.set(listingId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  rate(listingId: string, stars: number): MarketplaceListing | null {
    const l = this.listings.get(listingId);
    if (!l) return null;
    const s = Math.max(1, Math.min(5, Math.round(stars)));
    const count = l.ratingCount + 1;
    const avg = (l.ratingAvg * l.ratingCount + s) / count;
    const next = { ...l, ratingCount: count, ratingAvg: Math.round(avg * 100) / 100 };
    this.listings.set(listingId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /* ── helpers ── */

  private setVersion(id: string, patch: Partial<ListingVersion>): void {
    const v = this.versions.get(id);
    if (v) this.versions.set(id, { ...v, ...patch });
  }
  private setListingStatus(id: string, status: ListingStatus): void {
    const l = this.listings.get(id);
    if (l) this.listings.set(id, { ...l, status, updatedAt: new Date().toISOString() });
  }
  private event(listingId: string, versionId: string, action: string, actor: string, detail: string): void {
    this.events.push({ id: `sev_${randomUUID()}`, listingId, versionId, at: new Date().toISOString(), action, actor, detail });
    /**
     * PER LISTING. P13C ROUND 8. An install-wide slice let one publisher's
     * activity evict another publisher's submission trail — the record of what
     * was reviewed and approved. Tenth install-wide cap.
     */
    {
      const byListing = new Map<string, number>();
      const kept = new Set<(typeof this.events)[number]>();
      for (let i = this.events.length - 1; i >= 0; i -= 1) {
        const e = this.events[i]!;
        const key = e.listingId ?? '__none__';
        const n = byListing.get(key) ?? 0;
        if (n < EVENT_CAP) {
          kept.add(e);
          byListing.set(key, n + 1);
        }
      }
      this.events = this.events.filter((e) => kept.has(e));
    }
  }
}
