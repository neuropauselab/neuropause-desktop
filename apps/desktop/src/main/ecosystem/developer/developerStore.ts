/**
 * The Developer registry: developer accounts, API keys, OAuth applications, and
 * the raw usage ledger. API key + OAuth secrets are high-entropy tokens; only a
 * SHA-256 hash is persisted, and the clear secret is returned exactly once at
 * creation. Electron-free; the singleton lives in developerInstance.ts.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type {
  ApiKey,
  ApiKeyWithSecret,
  ApiScope,
  DeveloperAccount,
  OAuthApplication,
  OAuthApplicationWithSecret,
  OAuthGrantType,
  PlanTier,
  UsageRecord,
} from '@neuropause/shared';
import { createLogger } from '../../logger';

const log = createLogger('developer-registry');
const USAGE_CAP = 20_000;

interface StoredKey extends ApiKey {
  hash: string;
}
interface StoredApp extends OAuthApplication {
  secretHash: string;
}
interface DevFile {
  developers: DeveloperAccount[];
  keys: StoredKey[];
  apps: StoredApp[];
  usage: UsageRecord[];
  seeded: boolean;
}

export interface SeedDeveloper {
  id: string;
  name: string;
  email: string;
  organization: string;
  orgId: string;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export class DeveloperStore extends EventEmitter {
  private developers = new Map<string, DeveloperAccount>();
  private keys = new Map<string, StoredKey>();
  private apps = new Map<string, StoredApp>();
  private usage: UsageRecord[] = [];
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly seed: SeedDeveloper) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<DevFile>;
      for (const d of data.developers ?? []) if (d?.id) this.developers.set(d.id, d);
      for (const k of data.keys ?? []) if (k?.id) this.keys.set(k.id, k);
      for (const a of data.apps ?? []) if (a?.id) this.apps.set(a.id, a);
      this.usage = Array.isArray(data.usage) ? data.usage : [];
      if (!data.seeded || this.developers.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Developer registry ready', { developers: this.developers.size, keys: this.keys.size, apps: this.apps.size });
  }

  private applySeed(): void {
    if (!this.developers.has(this.seed.id)) {
      this.developers.set(this.seed.id, {
        id: this.seed.id,
        name: this.seed.name,
        email: this.seed.email,
        organization: this.seed.organization,
        orgId: this.seed.orgId,
        planTier: 'free',
        status: 'active',
        createdAt: new Date().toISOString(),
      });
    }
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const file: DevFile = {
      developers: [...this.developers.values()],
      keys: [...this.keys.values()],
      apps: [...this.apps.values()],
      usage: this.usage,
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
      log.error('Developer persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /* ── developers ── */

  defaultDeveloper(): DeveloperAccount {
    return this.developers.get(this.seed.id) ?? [...this.developers.values()][0];
  }
  developer(id: string): DeveloperAccount | null {
    return this.developers.get(id) ?? null;
  }
  setOwnerIdentity(name: string, email: string): void {
    const d = this.developers.get(this.seed.id);
    if (d && (d.name !== name || d.email !== email)) {
      this.developers.set(this.seed.id, { ...d, name, email });
      this.schedulePersist();
      this.emit('changed');
    }
  }
  setPlan(developerId: string, planTier: PlanTier): DeveloperAccount | null {
    const d = this.developers.get(developerId);
    if (!d) return null;
    const next = { ...d, planTier };
    this.developers.set(developerId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /* ── API keys ── */

  keysFor(developerId: string): ApiKey[] {
    return [...this.keys.values()].filter((k) => k.developerId === developerId).map(strip);
  }

  createKey(developerId: string, name: string, scopes: ApiScope[], expiresAt: string | null = null): ApiKeyWithSecret {
    const id = `key_${randomUUID()}`;
    const raw = randomBytes(24).toString('base64url');
    const prefix = `npk_live_${raw.slice(0, 6)}`;
    const secret = `${prefix}.${raw}`;
    const stored: StoredKey = {
      id,
      developerId,
      name,
      prefix,
      last4: raw.slice(-4),
      scopes,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      expiresAt,
      revokedAt: null,
      hash: sha256(secret),
    };
    this.keys.set(id, stored);
    this.schedulePersist();
    this.emit('changed');
    return { key: strip(stored), secret };
  }

  revokeKey(id: string): ApiKey | null {
    const k = this.keys.get(id);
    if (!k || k.revokedAt) return k ? strip(k) : null;
    const next = { ...k, revokedAt: new Date().toISOString() };
    this.keys.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return strip(next);
  }

  /** Resolve a presented raw token to its key, or null. Records last-used. */
  verifyKey(token: string): ApiKey | null {
    const hash = sha256(token);
    for (const k of this.keys.values()) {
      if (k.hash === hash) {
        if (k.revokedAt) return null;
        if (k.expiresAt && Date.parse(k.expiresAt) < Date.now()) return null;
        const next = { ...k, lastUsedAt: new Date().toISOString() };
        this.keys.set(k.id, next);
        this.schedulePersist();
        return strip(next);
      }
    }
    return null;
  }

  /* ── OAuth apps ── */

  appsFor(developerId: string): OAuthApplication[] {
    return [...this.apps.values()].filter((a) => a.developerId === developerId).map(stripApp);
  }

  createApp(developerId: string, name: string, redirectUris: string[], scopes: ApiScope[], grantTypes: OAuthGrantType[]): OAuthApplicationWithSecret {
    const id = `app_${randomUUID()}`;
    const clientId = `npc_${randomBytes(12).toString('hex')}`;
    const clientSecret = `nps_${randomBytes(24).toString('base64url')}`;
    const stored: StoredApp = {
      id,
      developerId,
      name,
      clientId,
      secretLast4: clientSecret.slice(-4),
      redirectUris,
      scopes,
      grantTypes,
      createdAt: new Date().toISOString(),
      secretHash: sha256(clientSecret),
    };
    this.apps.set(id, stored);
    this.schedulePersist();
    this.emit('changed');
    return { application: stripApp(stored), clientSecret };
  }

  deleteApp(id: string): boolean {
    const ok = this.apps.delete(id);
    if (ok) {
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }

  /* ── usage ── */

  recordUsage(rec: Omit<UsageRecord, 'id'>): UsageRecord {
    const full: UsageRecord = { id: `use_${randomUUID()}`, ...rec };
    this.usage.push(full);
    if (this.usage.length > USAGE_CAP) this.usage = this.usage.slice(this.usage.length - USAGE_CAP);
    this.schedulePersist();
    return full;
  }

  usageFor(developerId: string, sinceMs: number): UsageRecord[] {
    return this.usage.filter((u) => u.developerId === developerId && Date.parse(u.at) >= sinceMs);
  }

  countSince(developerId: string, sinceMs: number): number {
    return this.usageFor(developerId, sinceMs).length;
  }
}

function strip(k: StoredKey): ApiKey {
  const { hash: _hash, ...rest } = k;
  return rest;
}
function stripApp(a: StoredApp): OAuthApplication {
  const { secretHash: _secretHash, ...rest } = a;
  return rest;
}
