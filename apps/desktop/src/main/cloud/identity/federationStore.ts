/**
 * The identity federation store: SSO connections (SAML / OIDC), the SCIM
 * provisioning config, and the MFA policy — per tenant, seeded for the home
 * tenant. Secrets (SCIM tokens) are stored only as a last-4 hint. Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  IdentitySummary,
  MfaMethod,
  MfaPolicy,
  ScimConfig,
  SsoConnection,
  SsoProtocol,
  SsoStatus,
} from '@neuropause/shared';
import { createLogger } from '../../logger';

const log = createLogger('cloud-identity');

interface IdentityFile {
  connections: SsoConnection[];
  scim: ScimConfig[];
  mfa: MfaPolicy[];
  seeded: boolean;
}

export class FederationStore extends EventEmitter {
  private connections = new Map<string, SsoConnection>();
  private scim = new Map<string, ScimConfig>();
  private mfa = new Map<string, MfaPolicy>();
  private homeTenantId = '';

  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    super();
  }

  async load(homeTenantId: string): Promise<void> {
    if (this.loaded) return;
    this.homeTenantId = homeTenantId;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<IdentityFile>;
      for (const c of data.connections ?? []) if (c?.id) this.connections.set(c.id, c);
      for (const s of data.scim ?? []) if (s?.tenantId) this.scim.set(s.tenantId, s);
      for (const m of data.mfa ?? []) if (m?.tenantId) this.mfa.set(m.tenantId, m);
      if (!data.seeded || this.connections.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Cloud identity ready', { connections: this.connections.size, scim: this.scim.size, mfa: this.mfa.size });
  }

  private applySeed(): void {
    const t = this.homeTenantId;
    const now = new Date().toISOString();
    const saml: SsoConnection = {
      id: `sso_${randomUUID()}`,
      tenantId: t,
      name: 'Okta (SAML)',
      protocol: 'saml',
      status: 'active',
      issuer: 'http://www.okta.com/exk1a2b3c4',
      entityId: 'https://cloud.neuropause.app/saml/metadata',
      ssoUrl: 'https://neuropause.okta.com/app/exk1a2b3c4/sso/saml',
      clientId: '',
      domains: ['neuropause.app'],
      attributeMapping: { email: 'email', displayName: 'name', role: 'role' },
      enforced: false,
      createdAt: now,
    };
    const oidc: SsoConnection = {
      id: `sso_${randomUUID()}`,
      tenantId: t,
      name: 'Microsoft Entra ID (OIDC)',
      protocol: 'oidc',
      status: 'disabled',
      issuer: 'https://login.microsoftonline.com/common/v2.0',
      entityId: '',
      ssoUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      clientId: 'a1b2c3d4-1111-2222-3333-444455556666',
      domains: ['neuropause.app'],
      attributeMapping: { email: 'preferred_username', displayName: 'name', role: 'roles' },
      enforced: false,
      createdAt: now,
    };
    this.connections.set(saml.id, saml);
    this.connections.set(oidc.id, oidc);
    this.scim.set(t, { tenantId: t, status: 'disabled', tokenLast4: '', endpoint: 'https://cloud.neuropause.app/scim/v2', provisioned: 0, lastSyncAt: null });
    this.mfa.set(t, { tenantId: t, required: false, methods: ['totp', 'webauthn'], graceDays: 7 });
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const payload: IdentityFile = { connections: [...this.connections.values()], scim: [...this.scim.values()], mfa: [...this.mfa.values()], seeded: true };
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
      log.error('Identity persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  listConnections(): SsoConnection[] {
    return [...this.connections.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  connection(id: string): SsoConnection | null {
    return this.connections.get(id) ?? null;
  }
  scimConfig(tenantId?: string): ScimConfig | null {
    return this.scim.get(tenantId ?? this.homeTenantId) ?? null;
  }
  mfaPolicy(tenantId?: string): MfaPolicy | null {
    return this.mfa.get(tenantId ?? this.homeTenantId) ?? null;
  }

  summary(): IdentitySummary {
    const conns = [...this.connections.values()];
    const scim = this.scim.get(this.homeTenantId);
    const mfa = this.mfa.get(this.homeTenantId);
    return {
      connections: conns.length,
      active: conns.filter((c) => c.status === 'active').length,
      enforced: conns.some((c) => c.enforced && c.status === 'active'),
      scimEnabled: scim?.status === 'enabled',
      mfaRequired: mfa?.required ?? false,
      provisionedUsers: scim?.provisioned ?? 0,
    };
  }

  createConnection(input: { name: string; protocol: SsoProtocol; issuer: string; entityId?: string; ssoUrl: string; clientId?: string; domains: string[]; attributeMapping?: Record<string, string> }): SsoConnection {
    const id = `sso_${randomUUID()}`;
    const conn: SsoConnection = {
      id,
      tenantId: this.homeTenantId,
      name: input.name,
      protocol: input.protocol,
      status: 'disabled',
      issuer: input.issuer,
      entityId: input.entityId ?? '',
      ssoUrl: input.ssoUrl,
      clientId: input.clientId ?? '',
      domains: input.domains,
      attributeMapping: input.attributeMapping ?? { email: 'email', displayName: 'name', role: 'role' },
      enforced: false,
      createdAt: new Date().toISOString(),
    };
    this.connections.set(id, conn);
    this.schedulePersist();
    this.emit('changed');
    return conn;
  }

  updateConnection(id: string, patch: Partial<Pick<SsoConnection, 'status' | 'enforced' | 'domains' | 'name'>>): SsoConnection | null {
    const c = this.connections.get(id);
    if (!c) return null;
    const next: SsoConnection = { ...c, ...patch };
    this.connections.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  setStatus(id: string, status: SsoStatus): SsoConnection | null {
    return this.updateConnection(id, { status });
  }

  deleteConnection(id: string): boolean {
    const ok = this.connections.delete(id);
    if (ok) {
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }

  setScim(enabled: boolean): ScimConfig {
    const existing = this.scim.get(this.homeTenantId);
    const next: ScimConfig = {
      tenantId: this.homeTenantId,
      status: enabled ? 'enabled' : 'disabled',
      tokenLast4: enabled ? randomUUID().slice(0, 4) : '',
      endpoint: existing?.endpoint ?? 'https://cloud.neuropause.app/scim/v2',
      provisioned: enabled ? existing?.provisioned ?? 0 : 0,
      lastSyncAt: enabled ? new Date().toISOString() : null,
    };
    this.scim.set(this.homeTenantId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  recordScimSync(count: number): ScimConfig | null {
    const existing = this.scim.get(this.homeTenantId);
    if (!existing || existing.status !== 'enabled') return existing ?? null;
    const next: ScimConfig = { ...existing, provisioned: existing.provisioned + count, lastSyncAt: new Date().toISOString() };
    this.scim.set(this.homeTenantId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  setMfa(patch: { required?: boolean; methods?: MfaMethod[]; graceDays?: number }): MfaPolicy {
    const existing = this.mfa.get(this.homeTenantId) ?? { tenantId: this.homeTenantId, required: false, methods: ['totp'], graceDays: 7 };
    const next: MfaPolicy = {
      tenantId: this.homeTenantId,
      required: patch.required ?? existing.required,
      methods: patch.methods ?? existing.methods,
      graceDays: patch.graceDays ?? existing.graceDays,
    };
    this.mfa.set(this.homeTenantId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }
}
