/**
 * Enterprise Identity Platform (NCEA 14.0, Phase 1). The ONE identity registry:
 * users, service accounts, AI identities, external users, and guests are all
 * `Identity` records keyed by a stable subject id (shared with the rest of the
 * platform — no second user directory). Identities carry a tenant, a lifecycle
 * state, roles (consumed by the one authorization model), metadata, and an
 * optional federation source. Identity Providers (OIDC / SAML) are registered as
 * configs; live discovery + token/assertion exchange against Okta/Azure AD/Auth0/
 * Ping/Google Workspace is INFRA-PENDING (needs real metadata + certs).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { SecurityAudit } from './audit';

export const IDENTITY_TYPES = ['user', 'service-account', 'ai-identity', 'external', 'guest'] as const;
export type IdentityType = (typeof IDENTITY_TYPES)[number];

export const IDENTITY_STATES = ['provisioned', 'active', 'suspended', 'deprovisioned'] as const;
export type IdentityState = (typeof IDENTITY_STATES)[number];

export interface Identity {
  id: string;
  type: IdentityType;
  displayName: string;
  tenant: string;
  state: IdentityState;
  roles: string[];
  federationSource?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface IdentityProviderConfig {
  id: string;
  protocol: 'oidc' | 'saml';
  issuer: string;
  /** OIDC discovery / SAML metadata URL — resolved live in production. */
  metadataUrl: string;
  tenant: string;
}

export interface RegisterIdentityInput {
  type: IdentityType;
  displayName: string;
  tenant: string;
  roles?: string[];
  federationSource?: string;
  metadata?: Record<string, unknown>;
  actor?: string;
}

export class IdentityRegistry {
  private readonly identities = new Map<string, Identity>();
  private readonly providers = new Map<string, IdentityProviderConfig>();

  constructor(
    private readonly clock: Clock,
    private readonly audit: SecurityAudit,
  ) {}

  async register(input: RegisterIdentityInput): Promise<Identity> {
    const now = this.clock.now();
    const identity: Identity = {
      id: randomId(input.type === 'ai-identity' ? 'aiid' : input.type === 'service-account' ? 'svc' : 'usr'),
      type: input.type,
      displayName: input.displayName,
      tenant: input.tenant,
      state: 'provisioned',
      roles: input.roles ?? [],
      ...(input.federationSource ? { federationSource: input.federationSource } : {}),
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.identities.set(identity.id, identity);
    await this.audit.record({ category: 'identity', action: `register.${input.type}`, actor: input.actor ?? 'system', tenant: input.tenant, target: identity.id });
    return identity;
  }

  get(id: string): Identity | undefined {
    return this.identities.get(id);
  }

  list(filter: { type?: IdentityType; tenant?: string; state?: IdentityState } = {}): Identity[] {
    return [...this.identities.values()].filter(
      (i) => (filter.type === undefined || i.type === filter.type) && (filter.tenant === undefined || i.tenant === filter.tenant) && (filter.state === undefined || i.state === filter.state),
    );
  }

  /** A scoped directory view (user / org / workspace directories are `list` by tenant + type). */
  directory(tenant: string, type?: IdentityType): Identity[] {
    return this.list(type ? { tenant, type } : { tenant });
  }

  async setState(id: string, state: IdentityState, actor = 'system'): Promise<Identity> {
    const identity = this.require(id);
    identity.state = state;
    identity.updatedAt = this.clock.now();
    await this.audit.record({ category: 'identity', action: `lifecycle.${state}`, actor, tenant: identity.tenant, target: id });
    return identity;
  }

  activate(id: string, actor = 'system'): Promise<Identity> {
    return this.setState(id, 'active', actor);
  }
  suspend(id: string, actor = 'system'): Promise<Identity> {
    return this.setState(id, 'suspended', actor);
  }
  deprovision(id: string, actor = 'system'): Promise<Identity> {
    return this.setState(id, 'deprovisioned', actor);
  }

  async assignRole(id: string, role: string, actor = 'system'): Promise<Identity> {
    const identity = this.require(id);
    if (!identity.roles.includes(role)) identity.roles.push(role);
    identity.updatedAt = this.clock.now();
    await this.audit.record({ category: 'identity', action: 'role.assign', actor, tenant: identity.tenant, target: id, meta: { role } });
    return identity;
  }

  // ── federation (config-only; live exchange infra-pending) ──
  registerProvider(config: IdentityProviderConfig): IdentityProviderConfig {
    if (this.providers.has(config.id)) throw new Error(`identity provider '${config.id}' already registered`);
    this.providers.set(config.id, config);
    return config;
  }
  provider(id: string): IdentityProviderConfig | undefined {
    return this.providers.get(id);
  }
  providerList(): IdentityProviderConfig[] {
    return [...this.providers.values()];
  }

  health(): { total: number; byType: Record<string, number>; byState: Record<string, number>; providers: number } {
    const byType: Record<string, number> = {};
    const byState: Record<string, number> = {};
    for (const i of this.identities.values()) {
      byType[i.type] = (byType[i.type] ?? 0) + 1;
      byState[i.state] = (byState[i.state] ?? 0) + 1;
    }
    return { total: this.identities.size, byType, byState, providers: this.providers.size };
  }

  private require(id: string): Identity {
    const identity = this.identities.get(id);
    if (!identity) throw new Error(`identity '${id}' not found`);
    return identity;
  }
}
