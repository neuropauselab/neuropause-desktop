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
import { signArtifact, verifyArtifact, type SignableManifest } from './signing';
import { createLogger } from '../../logger';
import { demoSeedsEnabled } from '../../demoSeed';

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

  listArtifacts(): ExchangeArtifact[] {
    return [...this.artifacts.values()].sort((a, b) => b.installs - a.installs);
  }
  artifact(id: string): ExchangeArtifact | null {
    return this.artifacts.get(id) ?? null;
  }

  summary(): ExchangeSummary {
    const arts = [...this.artifacts.values()];
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

  scopeSummary(): MarketplaceScopeSummary[] {
    const scopes: ExchangeScope[] = ['private', 'public', 'partner', 'regional'];
    const arts = [...this.artifacts.values()];
    return scopes.map((scope) => ({ scope, artifacts: arts.filter((a) => a.scope === scope).length, installs: arts.filter((a) => a.scope === scope).reduce((n, a) => n + a.installs, 0) }));
  }

  publish(input: { kind: ExchangeKind; name: string; summary: string; scope: ExchangeScope; publisherOrg: string; publisherOrgName: string; regionId?: CloudRegionId | null }): ExchangeArtifact {
    const id = `art_${randomUUID()}`;
    const version = this.mkVersion({ kind: input.kind, name: input.name, version: '1.0.0', scope: input.scope, publisherOrg: input.publisherOrg }, 'Initial publish.');
    const artifact: ExchangeArtifact = {
      id,
      kind: input.kind,
      name: input.name,
      summary: input.summary,
      publisherOrg: input.publisherOrg,
      publisherOrgName: input.publisherOrgName,
      scope: input.scope,
      verification: 'unverified',
      regionId: input.regionId ?? null,
      rating: 0,
      ratingCount: 0,
      installs: 0,
      currentVersionId: version.id,
      versions: [version],
      createdAt: new Date().toISOString(),
    };
    this.artifacts.set(id, artifact);
    this.schedulePersist();
    this.emit('changed');
    return artifact;
  }

  publishVersion(artifactId: string, version: string, changelog: string): ExchangeArtifact | null {
    const a = this.artifacts.get(artifactId);
    if (!a) return null;
    const v = this.mkVersion({ kind: a.kind, name: a.name, version, scope: a.scope, publisherOrg: a.publisherOrg }, changelog);
    const next: ExchangeArtifact = { ...a, currentVersionId: v.id, versions: [...a.versions, v] };
    this.artifacts.set(artifactId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  rate(artifactId: string, stars: number): ExchangeArtifact | null {
    const a = this.artifacts.get(artifactId);
    if (!a) return null;
    const clamped = Math.max(1, Math.min(5, Math.round(stars)));
    const total = a.rating * a.ratingCount + clamped;
    const count = a.ratingCount + 1;
    const next: ExchangeArtifact = { ...a, rating: Math.round((total / count) * 10) / 10, ratingCount: count };
    this.artifacts.set(artifactId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  setVerification(artifactId: string, verification: VerificationStatus): ExchangeArtifact | null {
    const a = this.artifacts.get(artifactId);
    if (!a) return null;
    const next: ExchangeArtifact = { ...a, verification };
    this.artifacts.set(artifactId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  setScope(artifactId: string, scope: ExchangeScope): ExchangeArtifact | null {
    const a = this.artifacts.get(artifactId);
    if (!a) return null;
    const next: ExchangeArtifact = { ...a, scope };
    this.artifacts.set(artifactId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  install(artifactId: string): ExchangeArtifact | null {
    const a = this.artifacts.get(artifactId);
    if (!a) return null;
    const next: ExchangeArtifact = { ...a, installs: a.installs + 1 };
    this.artifacts.set(artifactId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /** Roll the current version back to the previous published one. */
  rollback(artifactId: string): ExchangeArtifact | null {
    const a = this.artifacts.get(artifactId);
    if (!a) return null;
    const idx = a.versions.findIndex((v) => v.id === a.currentVersionId);
    if (idx <= 0) return a;
    const versions = a.versions.map((v, i) => (i === idx ? { ...v, status: 'rolled_back' as const } : v));
    const prev = versions[idx - 1];
    const next: ExchangeArtifact = { ...a, versions, currentVersionId: prev.id };
    this.artifacts.set(artifactId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /** Verify the signature of a specific version against the store key. */
  verifyVersion(artifactId: string, versionId: string): boolean {
    const a = this.artifacts.get(artifactId);
    if (!a) return false;
    const v = a.versions.find((x) => x.id === versionId);
    if (!v) return false;
    return verifyArtifact({ kind: a.kind, name: a.name, version: v.version, scope: a.scope, publisherOrg: a.publisherOrg }, v.signature, this.publicKey);
  }
}
