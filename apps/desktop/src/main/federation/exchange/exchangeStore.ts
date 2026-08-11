/**
 * The organization exchange store. Publishable, **signed**, **versioned**
 * artifacts across six kinds (AI workers, connector packs, governance policies,
 * workflow templates, knowledge packages, dashboard templates), each with a
 * visibility scope (private / public / partner / regional — the marketplace
 * scopes), a verification status, ratings, installs, and rollback.
 *
 * Signatures are real Ed25519 over a canonical manifest; the keypair is
 * generated on first run and persisted (PEM) so signatures verify across
 * restarts. Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID, generateKeyPairSync, createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import type {
  CloudRegionId,
  ExchangeArtifact,
  ExchangeKind,
  ExchangeScope,
  ExchangeSummary,
  ExchangeVersion,
  MarketplaceScopeSummary,
  VerificationStatus,
} from '@neuropause/shared';
import { EXCHANGE_KINDS } from '@neuropause/shared';
import type { TenantScope } from '@neuropause/shared';
import { FederationBoundary } from '../tenancy/federationBoundary';
import { signArtifact, verifyArtifact, type SignableManifest } from './signing';
import { createLogger } from '../../logger';
import { demoSeedsEnabled } from '../../demoSeed';
import { declareStoreScope } from '../../tenancy/storeScope';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'federation-exchange-artifacts',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  /**
   * P13C ROUND 10 — NONE, verified by reading every write path rather than by
   * trusting the previous one-line summary.
   *
   * `this.artifacts` is only ever `.set()` — nine call sites, all upserts. There
   * is no `delete`, no `clear`, no `splice`, no cap and no TTL. The single
   * `slice` in the file is `digest('hex').slice(0, 16)` building a key id, which
   * shortens a STRING and removes no row. Versions accumulate: rollback appends
   * a status change (`rolled_back`), it does not drop the version.
   */
  retentionScope: 'NONE',
  retentionAuthority: 'NONE',
  retention:
    'NOTHING IS EVER REMOVED. No cap, no TTL, no eviction and no delete path: every mutation is an ' +
    'upsert into the artifact Map, and rollback marks a version `rolled_back` rather than dropping ' +
    'it — which is the right shape for a signed publication history, since a version that can ' +
    'vanish cannot be verified after the fact. The file therefore grows with publication volume; ' +
    'if a cap is ever added it must be per publisherOrg, because `publisherOrg` is already the ' +
    'read predicate.',
  reason: "a.publisherOrg compared to the caller's org, and publisherOrg is no longer a parameter. Private drafts and per-org install records are the publishing organization's business.",
});

const log = createLogger('federation-exchange');

interface ExchangeFile {
  artifacts: ExchangeArtifact[];
  privateKeyPem: string;
  publicKeyPem: string;
  seeded: boolean;
}

interface SeedArtifact {
  kind: ExchangeKind;
  name: string;
  summary: string;
  publisherOrg: string;
  publisherOrgName: string;
  scope: ExchangeScope;
  verification: VerificationStatus;
  regionId: CloudRegionId | null;
  rating: number;
  ratingCount: number;
  installs: number;
  version: string;
}

const SEED_ARTIFACTS: SeedArtifact[] = [
  { kind: 'ai_worker', name: 'Compliance Reviewer', summary: 'Reviews documents against governance policy and flags risks.', publisherOrg: 'org-default', publisherOrgName: 'NeuroPause', scope: 'partner', verification: 'official', regionId: null, rating: 4.8, ratingCount: 64, installs: 212, version: '1.4.0' },
  { kind: 'connector_pack', name: 'NetSuite Pack', summary: 'OAuth connector + sync adapter for NetSuite finance objects.', publisherOrg: 'org-aperture', publisherOrgName: 'Aperture Capital', scope: 'public', verification: 'verified', regionId: null, rating: 4.5, ratingCount: 41, installs: 388, version: '2.1.0' },
  { kind: 'governance_policy', name: 'Data Handling Baseline', summary: 'A SOC 2-aligned data handling and retention policy set.', publisherOrg: 'org-default', publisherOrgName: 'NeuroPause', scope: 'public', verification: 'official', regionId: null, rating: 4.9, ratingCount: 120, installs: 540, version: '3.0.1' },
  { kind: 'workflow_template', name: 'Quarterly Close', summary: 'A multi-step finance close workflow with approval checkpoints.', publisherOrg: 'org-aperture', publisherOrgName: 'Aperture Capital', scope: 'partner', verification: 'verified', regionId: 'us-west', rating: 4.6, ratingCount: 28, installs: 96, version: '1.2.0' },
  { kind: 'knowledge_package', name: 'EU Compliance Corpus', summary: 'A curated knowledge package of EU regulatory references.', publisherOrg: 'org-helios', publisherOrgName: 'Helios Commerce', scope: 'regional', verification: 'verified', regionId: 'eu-west', rating: 4.4, ratingCount: 19, installs: 73, version: '0.9.0' },
  { kind: 'dashboard_template', name: 'Executive Overview', summary: 'A leadership dashboard template across workforce + ops.', publisherOrg: 'org-default', publisherOrgName: 'NeuroPause', scope: 'private', verification: 'unverified', regionId: null, rating: 0, ratingCount: 0, installs: 4, version: '0.1.0' },
];

export class ExchangeStore extends EventEmitter {
  /** The relationship boundary. Registered with the startup gate by construction. */
  private readonly fed = new FederationBoundary('federation-exchange');
  /**
   * Resolves whether the caller has an active trust relationship with a
   * publisher. Injected rather than imported, because `fedStore` is the other
   * half of this subsystem and importing it here would make the two circular.
   *
   * Defaults to "no trust", which is the fail-closed answer: an unwired
   * exchange treats every partner-scoped artifact as invisible rather than as
   * public.
   */
  private trustsPublisher: (publisherOrg: string) => boolean = () => false;
  /** The caller's own region. Unwired means null, which denies regional scope. */
  private callerRegion: () => CloudRegionId | null = () => null;
  private artifacts = new Map<string, ExchangeArtifact>();
  private privateKey!: KeyObject;
  private publicKey!: KeyObject;
  private keyId = '';

  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    super();
  }

  /** Bind the relationship boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.fed.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.fed.hasScope();
  }
  /** Wire the partner-visibility predicate. Called once by the composition root. */
  bindTrustResolver(resolver: (publisherOrg: string) => boolean): this {
    this.trustsPublisher = resolver;
    return this;
  }
  /** Wire the caller's own region, for `regional` scope. Null denies. */
  bindRegionResolver(resolver: () => CloudRegionId | null): this {
    this.callerRegion = resolver;
    return this;
  }
  /** Unscoped ownership counts over artifacts, for the migration inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.fed.countOwnership(
      [...this.artifacts.values()].map((a) => ({ owner: a.publisherOrg || null, peer: null })),
    );
  }

  /**
   * WHETHER THE CALLER MAY SEE THIS ARTIFACT. The one visibility rule.
   *
   * The publisher always can. Everybody else depends on the scope the publisher
   * chose, and the scopes mean different things:
   *
   *   private   — the publisher only. An unpublished draft.
   *   partner   — organizations with an active trust relationship TO the
   *               publisher. This is the case that makes the exchange a
   *               federation rather than a marketplace.
   *   regional  — organizations in the artifact's own region. Data-residency
   *               distribution, not a security boundary on its own.
   *   public    — any organization on the federation.
   *
   * An unresolved caller sees nothing, including public artifacts. That is
   * deliberate: "public" means public to the federation, and someone with no
   * organization is not in it.
   */
  private visibleToCaller(a: ExchangeArtifact): boolean {
    const me = this.fed.callerOrg();
    if (me === null) return false;
    if (a.publisherOrg === me) return true;
    switch (a.scope) {
      case 'private':
        return false;
      case 'partner':
        return this.trustsPublisher(a.publisherOrg);
      case 'regional':
        return a.regionId === null ? false : this.callerRegionMatches(a.regionId);
      case 'public':
        return true;
      default:
        return false;
    }
  }

  /**
   * Region comparison for `regional` scope.
   *
   * The caller's region comes from its organization row in the federation
   * directory, injected as a resolver for the same reason the trust predicate
   * is: `fedStore` owns that directory and importing it here would make the two
   * halves circular.
   *
   * I first resolved this by looking for a regional artifact the caller had
   * published — no injection, no coupling — and it was wrong in the way weak
   * heuristics usually are: an organization that had simply never published
   * anything regional could not see regional content addressed to its own
   * region. Fail-closed, but closed against the legitimate case. Worth keeping
   * the note: "cheap and fail-closed" is not the same as "correct".
   *
   * Unresolved region still denies.
   */
  private callerRegionMatches(regionId: CloudRegionId): boolean {
    const mine = this.callerRegion();
    return mine !== null && mine === regionId;
  }

  /**
   * The artifact IF the caller may see it, with other organizations' install
   * records stripped. The single resolve every read and write goes through.
   */
  private visible(id: string): ExchangeArtifact | null {
    const a = this.artifacts.get(id) ?? null;
    if (a === null || !this.visibleToCaller(a)) return null;
    return this.redact(a);
  }

  /**
   * The artifact the caller PUBLISHED, or null. For every write that only the
   * publisher may perform.
   */
  private mine(id: string): ExchangeArtifact | null {
    const me = this.fed.callerOrg();
    const a = this.artifacts.get(id) ?? null;
    if (a === null || me === null || a.publisherOrg !== me) return null;
    return a;
  }

  /**
   * Strip other organizations' installation records.
   *
   * `installs` — the aggregate count — stays, because an install count is an
   * ordinary public marketplace signal. WHICH organizations installed is not:
   * it is a list of who uses what, across customers. The caller sees its own
   * entry so the UI can render "installed", and nobody else's.
   */
  /**
   * P13C ROUND 4 — EVERY RETURN PATH REDACTS, not just the read ones.
   *
   * The sweep found `rate()` handing back the raw map entry: it used `visible()`
   * as a boolean and then re-read `this.artifacts`, so the response carried
   * `installations` for EVERY organization. `rate` is deliberately open to any
   * org that can see an artifact, which is what made it the reachable one — a
   * five-star rating on any public package returned a cross-customer list of who
   * uses it, with timestamps and pinned versions.
   *
   * `publishVersion`, `setVerification`, `setScope` and `rollback` had the same
   * shape with a narrower blast radius (publisher-only), which is the version of
   * this bug that survives review: four callers looked fine because the fifth was
   * the only one an outsider could reach.
   */
  private redact(a: ExchangeArtifact): ExchangeArtifact {
    const me = this.fed.callerOrg();
    const mine = (a.installations ?? []).filter((i) => i.orgId === me);
    return { ...a, installations: mine };
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<ExchangeFile>;
      if (data.privateKeyPem && data.publicKeyPem) {
        this.privateKey = createPrivateKey(data.privateKeyPem);
        this.publicKey = createPublicKey(data.publicKeyPem);
      } else {
        this.generateKeys();
      }
      this.computeKeyId();
      for (const a of data.artifacts ?? []) if (a?.id) this.artifacts.set(a.id, a);
      if (!data.seeded || this.artifacts.size === 0) this.applySeed();
    } catch {
      this.generateKeys();
      this.computeKeyId();
      this.applySeed();
    }
    this.loaded = true;
    log.info('Organization exchange ready', { artifacts: this.artifacts.size, keyId: this.keyId });
  }

  private generateKeys(): void {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }
  private computeKeyId(): void {
    const pem = this.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    this.keyId = `npfed_${createHash('sha256').update(pem).digest('hex').slice(0, 16)}`;
  }

  private mkVersion(manifest: SignableManifest, changelog: string, now = Date.now()): ExchangeVersion {
    const sig = signArtifact(manifest, this.privateKey, this.keyId, new Date(now).toISOString());
    return { id: `ver_${randomUUID()}`, version: manifest.version, changelog, digest: sig.digest, signature: sig, status: 'published', publishedAt: new Date(now).toISOString() };
  }

  private applySeed(): void {
    // The seeded artifacts below carry fabricated install counts and star ratings, so they must never appear in
    // a production exchange — a fresh install shows an empty, honest marketplace. They remain available for
    // local demos behind the demo-seed flag; persist the (empty) seeded state so the flag is recorded.
    if (!demoSeedsEnabled()) {
      this.schedulePersist();
      return;
    }
    const now = Date.now();
    for (const s of SEED_ARTIFACTS) {
      const id = `art_${randomUUID()}`;
      const version = this.mkVersion({ kind: s.kind, name: s.name, version: s.version, scope: s.scope, publisherOrg: s.publisherOrg }, 'Initial publish.', now - 14 * 86_400_000);
      this.artifacts.set(id, {
        id,
        kind: s.kind,
        name: s.name,
        summary: s.summary,
        publisherOrg: s.publisherOrg,
        publisherOrgName: s.publisherOrgName,
        scope: s.scope,
        verification: s.verification,
        regionId: s.regionId,
        rating: s.rating,
        ratingCount: s.ratingCount,
        installs: s.installs,
        currentVersionId: version.id,
        versions: [version],
        createdAt: new Date(now - 14 * 86_400_000).toISOString(),
      });
    }
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const payload: ExchangeFile = {
      artifacts: [...this.artifacts.values()],
      privateKeyPem: this.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKeyPem: this.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      seeded: true,
    };
    await fs.writeFile(tmp, JSON.stringify(payload), { mode: 0o600 });
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
      log.error('Exchange persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  signingKeyId(): string {
    return this.keyId;
  }

  /** The artifacts the caller may SEE. Was every artifact on the install. */
  listArtifacts(): ExchangeArtifact[] {
    return [...this.artifacts.values()]
      .filter((a) => this.visibleToCaller(a))
      .map((a) => this.redact(a))
      .sort((a, b) => b.installs - a.installs);
  }
  /** One artifact, if visible. A private artifact of another org reads as absent. */
  artifact(id: string): ExchangeArtifact | null {
    return this.visible(id);
  }

  /** Counts over what the CALLER may see. Was an install-wide census. */
  summary(): ExchangeSummary {
    const arts = this.listArtifacts();
    const byKind: Record<string, number> = {};
    for (const k of EXCHANGE_KINDS) byKind[k] = arts.filter((a) => a.kind === k).length;
    return {
      artifacts: arts.length,
      byKind,
      published: arts.filter((a) => a.versions.some((v) => v.status === 'published')).length,
      verified: arts.filter((a) => a.verification !== 'unverified').length,
      installs: arts.reduce((n, a) => n + a.installs, 0),
    };
  }

  /**
   * Scope breakdown over what the caller may see.
   *
   * Sharper than it looks: unscoped, the `private` row was a count of every
   * other organization's UNPUBLISHED drafts — the one scope that exists
   * precisely to not be seen.
   */
  scopeSummary(): MarketplaceScopeSummary[] {
    const scopes: ExchangeScope[] = ['private', 'public', 'partner', 'regional'];
    const arts = this.listArtifacts();
    return scopes.map((scope) => ({ scope, artifacts: arts.filter((a) => a.scope === scope).length, installs: arts.filter((a) => a.scope === scope).reduce((n, a) => n + a.installs, 0) }));
  }

  /**
   * Publish a new artifact. THE PUBLISHER IS THE CALLER.
   *
   * `publisherOrg` used to arrive as a parameter, and the IPC handler passed the
   * literal seeded `ORG_ID` — so every tenant's artifact claimed the seeded
   * organization as its publisher, and the Ed25519 signature was computed over
   * that false claim. The manifest is signed, which made the forged attribution
   * cryptographically attested.
   *
   * The parameter is gone rather than validated. A validated parameter is one
   * refactor away from being trusted again.
   */
  publish(input: { kind: ExchangeKind; name: string; summary: string; scope: ExchangeScope; publisherOrgName: string; regionId?: CloudRegionId | null }): ExchangeArtifact {
    const publisherOrg = this.fed.requireCallerOrg();
    const id = `art_${randomUUID()}`;
    const version = this.mkVersion({ kind: input.kind, name: input.name, version: '1.0.0', scope: input.scope, publisherOrg }, 'Initial publish.');
    const artifact: ExchangeArtifact = {
      id,
      kind: input.kind,
      name: input.name,
      summary: input.summary,
      publisherOrg,
      publisherOrgName: input.publisherOrgName,
      scope: input.scope,
      verification: 'unverified',
      regionId: input.regionId ?? null,
      rating: 0,
      ratingCount: 0,
      installs: 0,
      currentVersionId: version.id,
      versions: [version],
      installations: [],
      createdAt: new Date().toISOString(),
    };
    this.artifacts.set(id, artifact);
    this.schedulePersist();
    this.emit('changed');
    return artifact;
  }

  /**
   * Publish a new version. PUBLISHER ONLY.
   *
   * Took a bare payload id, so any tenant could push a version onto any
   * artifact — and `mkVersion` SIGNS it with the store key under the artifact's
   * publisher identity. That is not tampering that a signature check catches;
   * it is a forged release signed as genuine.
   */
  publishVersion(artifactId: string, version: string, changelog: string): ExchangeArtifact | null {
    const a = this.mine(artifactId);
    if (!a) return null;
    const v = this.mkVersion({ kind: a.kind, name: a.name, version, scope: a.scope, publisherOrg: a.publisherOrg }, changelog);
    const next: ExchangeArtifact = { ...a, currentVersionId: v.id, versions: [...a.versions, v] };
    this.artifacts.set(artifactId, next);
    this.schedulePersist();
    this.emit('changed');
    return this.redact(next);
  }

  /**
   * Rate an artifact. ANY ORGANIZATION THAT CAN SEE IT.
   *
   * Deliberately not publisher-only: rating something you can see is the point
   * of a marketplace. Scoped to visibility, so a private artifact cannot be
   * rated — and therefore cannot be probed for existence — by a stranger.
   */
  rate(artifactId: string, stars: number): ExchangeArtifact | null {
    if (this.visible(artifactId) === null) return null;
    const a = this.artifacts.get(artifactId) as ExchangeArtifact;
    const clamped = Math.max(1, Math.min(5, Math.round(stars)));
    const total = a.rating * a.ratingCount + clamped;
    const count = a.ratingCount + 1;
    const next: ExchangeArtifact = { ...a, rating: Math.round((total / count) * 10) / 10, ratingCount: count };
    this.artifacts.set(artifactId, next);
    this.schedulePersist();
    this.emit('changed');
    return this.redact(next);
  }

  /**
   * Set verification status. PUBLISHER ONLY, and that is a compromise worth naming.
   *
   * Took a bare id, so one tenant could mark another's artifact `official` — or
   * strip a real verification down to `unverified` and make a legitimate package
   * look untrustworthy.
   *
   * Publisher-only closes the cross-tenant hole and leaves SELF-ATTESTATION:
   * a publisher can still call its own artifact "official". The real fix is a
   * platform verifier role that is not the publisher, which is a product
   * decision rather than a security patch. Recorded as open work rather than
   * quietly implied to be solved.
   */
  setVerification(artifactId: string, verification: VerificationStatus): ExchangeArtifact | null {
    const a = this.mine(artifactId);
    if (!a) return null;
    const next: ExchangeArtifact = { ...a, verification };
    this.artifacts.set(artifactId, next);
    this.schedulePersist();
    this.emit('changed');
    return this.redact(next);
  }

  /**
   * Change visibility scope. PUBLISHER ONLY.
   *
   * The sharpest of the bare-id writes on reflection: it is the setting that
   * DECIDES visibility. A stranger flipping another organization's `private`
   * draft to `public` publishes it to the whole federation in one call.
   */
  setScope(artifactId: string, scope: ExchangeScope): ExchangeArtifact | null {
    const a = this.mine(artifactId);
    if (!a) return null;
    const next: ExchangeArtifact = { ...a, scope };
    this.artifacts.set(artifactId, next);
    this.schedulePersist();
    this.emit('changed');
    return this.redact(next);
  }

  /**
   * Install an artifact into the CALLER'S organization.
   *
   * PUBLISHER OWNERSHIP IS NOT REWRITTEN. An installation is a second, separate
   * fact — who installed, which version, when — recorded beside the artifact
   * rather than on top of it. Conflating the two is how "B installed A's pack"
   * becomes "B published it".
   *
   * Gated on VISIBILITY rather than ownership, because installing another
   * organization's artifact is the entire purpose of the exchange. What it
   * cannot do is install something the caller may not see: `private` and
   * unmatched `partner` artifacts are absent, so the id resolves to nothing.
   *
   * Re-installing is idempotent on the installer list and does not inflate the
   * counter — otherwise the public install count is a click away from being
   * fiction.
   */
  install(artifactId: string): ExchangeArtifact | null {
    const me = this.fed.callerOrg();
    if (me === null || this.visible(artifactId) === null) return null;
    const a = this.artifacts.get(artifactId) as ExchangeArtifact;
    const already = (a.installations ?? []).some((i) => i.orgId === me);
    if (already) return this.redact(a);
    const installation = {
      orgId: me,
      versionId: a.currentVersionId,
      installedAt: new Date().toISOString(),
    };
    const next: ExchangeArtifact = {
      ...a,
      installs: a.installs + 1,
      installations: [...(a.installations ?? []), installation],
    };
    this.artifacts.set(artifactId, next);
    this.schedulePersist();
    this.emit('changed');
    return this.redact(next);
  }

  /**
   * Roll the current version back to the previous published one. PUBLISHER ONLY.
   *
   * A rollback is a supply-chain action against every organization that
   * installed the artifact: it moves them onto an older release and marks the
   * current one `rolled_back`. On a bare id, any tenant could do that to any
   * publisher's package.
   */
  rollback(artifactId: string): ExchangeArtifact | null {
    const a = this.mine(artifactId);
    if (!a) return null;
    const idx = a.versions.findIndex((v) => v.id === a.currentVersionId);
    if (idx <= 0) return a;
    const versions = a.versions.map((v, i) => (i === idx ? { ...v, status: 'rolled_back' as const } : v));
    const prev = versions[idx - 1];
    const next: ExchangeArtifact = { ...a, versions, currentVersionId: prev.id };
    this.artifacts.set(artifactId, next);
    this.schedulePersist();
    this.emit('changed');
    return this.redact(next);
  }

  /**
   * Verify the signature of a specific version against the store key.
   *
   * Scoped to visibility. A signature check over an invisible artifact returns
   * true or false and therefore answers "does this id exist?" — a small oracle,
   * but one on an ungated read channel.
   */
  verifyVersion(artifactId: string, versionId: string): boolean {
    const a = this.visible(artifactId);
    if (!a) return false;
    const v = a.versions.find((x) => x.id === versionId);
    if (!v) return false;
    return verifyArtifact({ kind: a.kind, name: a.name, version: v.version, scope: a.scope, publisherOrg: a.publisherOrg }, v.signature, this.publicKey);
  }
}
