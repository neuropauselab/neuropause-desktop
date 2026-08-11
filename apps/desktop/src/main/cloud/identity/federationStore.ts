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
import { demoSeedsEnabled } from '../../demoSeed';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';

const log = createLogger('cloud-identity');

interface IdentityFile {
  connections: SsoConnection[];
  scim: ScimConfig[];
  mfa: MfaPolicy[];
  seeded: boolean;
}

export class FederationStore extends EventEmitter {
  /**
   * P13C ROUND 6 — THE F10 BOUNDARY STOPPED AT THE `load()` CALL.
   *
   * Round 5 gave `TenancyStore` a real organization↔cloud-tenant mapping. This
   * store is handed the result of that mapping ONCE, at boot —
   * `federationStore.load(homeTenantId)` — and freezes it in a private field
   * that never changes. Every per-caller operation then resolves through that
   * constant:
   *
   *   createConnection()  stamped tenant B's SSO connection with tenant A's id
   *   setScim/setMfa      wrote tenant B's posture into tenant A's record
   *   summary()           showed every tenant the SEEDED org's SSO posture
   *   listConnections()   returned every organization's `issuer`, `entityId`,
   *                       `ssoUrl`, `clientId`, `domains` and attribute mapping
   *   update/delete       took a bare id, so a `cloud:manage` holder in one
   *                       tenant could DISABLE OR DELETE another tenant's SSO
   *                       connection — an authentication-control mutation
   *
   * It is the same shape as `ORG_ID` under a different name: `homeTenantId` is
   * derived from `ORG_ID` at the instance, and nothing ever read the `tenantId`
   * field the records already carried.
   *
   * `homeTenantId` survives for what it is genuinely for — seeding, and the
   * boot-time default before any caller exists. It authorizes nothing.
   */
  private readonly tenancy = new TenantOwnership('cloud-identity-federation');

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }

  /**
   * The CALLER'S cloud tenant id, resolved through the injected mapping.
   *
   * Injected rather than imported: `TenancyStore` owns the organization→cloud
   * tenant mapping and importing it here would couple the two stores. Null means
   * DENY — never the seeded org.
   */
  private callerCloudTenant: () => string | null = () => null;
  bindCloudTenantResolver(resolver: () => string | null): this {
    this.callerCloudTenant = resolver;
    return this;
  }
  /** Unscoped ownership counts, for the migration inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.tenancy.countOwnership(
      [...this.connections.values()].map((c) => ({ tenantId: c.tenantId })),
    );
  }
  /**
   * The caller's cloud tenant, or a refusal.
   *
   * Writes throw where reads return empty — the rule the rest of this program
   * uses — because a write with no tenant would have to invent one, and the
   * invented one used to be the seeded organization's.
   */
  private requireCloudTenant(): string {
    const id = this.callerCloudTenant();
    if (id === null || id === '') {
      throw new Error('No organization is active, so this identity record has no owner.');
    }
    return id;
  }

  /** Rows belonging to the caller's cloud tenant. The one filter. */
  private mine<T extends { tenantId: string }>(rows: readonly T[]): T[] {
    const mineId = this.callerCloudTenant();
    if (mineId === null || mineId === '') return [];
    return rows.filter((r) => r.tenantId === mineId);
  }

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
    // A fresh production install has NO configured SSO — the honest default is an empty connection list with
    // SCIM/MFA off. The sample Okta/Entra connections below only exist when demo seeds are enabled; otherwise
    // we seed just the (disabled) SCIM + MFA posture so the identity summary reads a truthful "none active".
    if (!demoSeedsEnabled()) {
      this.scim.set(t, { tenantId: t, status: 'disabled', tokenLast4: '', endpoint: 'https://cloud.neuropause.app/scim/v2', provisioned: 0, lastSyncAt: null });
      this.mfa.set(t, { tenantId: t, required: false, methods: ['totp', 'webauthn'], graceDays: 7 });
      this.schedulePersist();
      return;
    }
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

  /**
   * The CALLER'S SSO connections.
   *
   * P13C ROUND 6 — THIS BODY WAS NEVER FILTERED, while the header of this file
   * asserted it had been. My own comment, written in this round, claimed the fix
   * and the code returned `[...this.connections.values()]` — every organization's
   * `issuer`, `entityId`, `ssoUrl`, `clientId` and `domains`. It was caught by the
   * three-tenant test and by nothing else, which is the whole argument for
   * writing the test: a comment is not evidence, including one I just wrote.
   */
  listConnections(): SsoConnection[] {
    return this.mine([...this.connections.values()]).sort((a, b) => a.name.localeCompare(b.name));
  }
  /** One connection, IF the caller's cloud tenant owns it. */
  connection(id: string): SsoConnection | null {
    const c = this.connections.get(id) ?? null;
    return c !== null && this.mine([c]).length === 1 ? c : null;
  }
  /**
   * SCIM config for the CALLER'S cloud tenant.
   *
   * P13C ROUND 6 — THE OPTIONAL `tenantId` PARAMETER IS GONE. No production
   * caller passed one (`cloud/index.ts` calls it bare in all three places), and
   * an optional id argument on a scoped read is the "bare id authorizes" shape
   * this program has removed from a dozen stores — it survives review precisely
   * because nothing uses it yet.
   */
  scimConfig(): ScimConfig | null {
    const key = this.callerCloudTenant();
    return key === null || key === '' ? null : (this.scim.get(key) ?? null);
  }
  /** MFA policy for the CALLER'S cloud tenant. See `scimConfig` on the dropped id. */
  mfaPolicy(): MfaPolicy | null {
    const key = this.callerCloudTenant();
    return key === null || key === '' ? null : (this.mfa.get(key) ?? null);
  }

  summary(): IdentitySummary {
    /**
     * P13C ROUND 6 — `[...this.connections.values()]`, UNFILTERED.
     *
     * The listing was scoped and the SUMMARY OVER THE SAME COLLECTION was not, so
     * `connections`, `active` and `enforced` counted every organization's SSO. A
     * count is not nothing here: "is SSO enforced" is a security posture claim,
     * and reading another tenant's `true` tells this tenant it is protected when
     * it is not. Same array, same file, two different answers — the shape a
     * reviewer walks past because the neighbouring method is correct.
     */
    const conns = this.mine([...this.connections.values()]);
    /**
     * `scimConfig()` / `mfaPolicy()` — and NOT this, until now.
     *
     * `?? ''` is not a harmless default here: `''` is a POPULATED key. The boot
     * seed writes under `homeTenantId`, and `cloud/index.ts` computes that as
     * `home?.id ?? ''`, so on an install where `homeTenant()` is null at boot the
     * seeded SCIM and MFA posture live at `''`. Every unresolved caller then read
     * it back as its OWN `scimEnabled` / `mfaRequired` / `provisionedUsers` —
     * a security-posture claim, sourced from a partition that belongs to nobody.
     */
    const scim = this.scimConfig();
    const mfa = this.mfaPolicy();
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
      tenantId: this.requireCloudTenant(),
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

  /**
   * Update one of the CALLER'S SSO connections.
   *
   * Took a bare payload id. Disabling or deleting another organization's SSO
   * connection is an authentication-control mutation — the sharpest write on
   * this surface, because it does not disclose anything and can lock a customer
   * out of their own tenant.
   */
  updateConnection(id: string, patch: Partial<Pick<SsoConnection, 'status' | 'enforced' | 'domains' | 'name'>>): SsoConnection | null {
    if (this.connection(id) === null) return null;
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

  /** Delete one of the CALLER'S SSO connections. Was a bare payload id. */
  deleteConnection(id: string): boolean {
    if (this.connection(id) === null) return false;
    const ok = this.connections.delete(id);
    if (ok) {
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }

  setScim(enabled: boolean): ScimConfig {
    const existing = this.scim.get(this.callerCloudTenant() ?? '');
    const next: ScimConfig = {
      tenantId: this.requireCloudTenant(),
      status: enabled ? 'enabled' : 'disabled',
      tokenLast4: enabled ? randomUUID().slice(0, 4) : '',
      endpoint: existing?.endpoint ?? 'https://cloud.neuropause.app/scim/v2',
      provisioned: enabled ? existing?.provisioned ?? 0 : 0,
      lastSyncAt: enabled ? new Date().toISOString() : null,
    };
    this.scim.set(this.requireCloudTenant(), next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  recordScimSync(count: number): ScimConfig | null {
    const existing = this.scim.get(this.callerCloudTenant() ?? '');
    if (!existing || existing.status !== 'enabled') return existing ?? null;
    const next: ScimConfig = { ...existing, provisioned: existing.provisioned + count, lastSyncAt: new Date().toISOString() };
    this.scim.set(this.requireCloudTenant(), next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  setMfa(patch: { required?: boolean; methods?: MfaMethod[]; graceDays?: number }): MfaPolicy {
    const existing = this.mfa.get(this.callerCloudTenant() ?? '') ?? { tenantId: this.requireCloudTenant(), required: false, methods: ['totp'] as MfaMethod[], graceDays: 7 };
    const next: MfaPolicy = {
      tenantId: this.requireCloudTenant(),
      required: patch.required ?? existing.required,
      methods: patch.methods ?? existing.methods,
      graceDays: patch.graceDays ?? existing.graceDays,
    };
    this.mfa.set(this.requireCloudTenant(), next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }
}
