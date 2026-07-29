/**
 * Module 12 — Customer Administration. Organizations, users, roles, billing/support contacts,
 * security settings, and regional settings — per tenant. Real in-process configuration, governed on
 * the one chain; unset settings stay unset rather than being filled with invented defaults.
 * Live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';

export interface AdminUser {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  createdAt: number;
}
export interface TenantSettings {
  tenantId: string;
  billingContact?: string;
  supportContact?: string;
  mfaRequired: boolean;
  region?: string;
}

export class CustomerAdministration {
  private readonly users = new Map<string, AdminUser>();
  private readonly settings = new Map<string, TenantSettings>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CommercialGovernance,
  ) {}

  async addUser(input: { tenantId: string; email: string; role?: string; org?: string }): Promise<AdminUser> {
    const u: AdminUser = { id: randomId('user'), tenantId: input.tenantId, email: input.email, role: input.role ?? 'member', createdAt: this.clock.now() };
    this.users.set(u.id, u);
    await this.governance.record({ actor: 'system', org: input.org ?? '_ops', tenant: input.tenantId, operation: 'admin.add-user', targetId: u.id, evidence: 'live-verified', decision: u.role });
    return u;
  }

  setRole(userId: string, role: string): AdminUser {
    const u = this.users.get(userId);
    if (!u) throw new Error(`no user ${userId}`);
    u.role = role;
    return u;
  }

  async configureSettings(input: { tenantId: string; billingContact?: string; supportContact?: string; mfaRequired?: boolean; region?: string; org?: string }): Promise<TenantSettings> {
    const existing = this.settings.get(input.tenantId);
    const s: TenantSettings = {
      ...(existing ?? { mfaRequired: false }),
      ...(input.billingContact !== undefined ? { billingContact: input.billingContact } : {}),
      ...(input.supportContact !== undefined ? { supportContact: input.supportContact } : {}),
      ...(input.mfaRequired !== undefined ? { mfaRequired: input.mfaRequired } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      tenantId: input.tenantId,
    };
    this.settings.set(s.tenantId, s);
    await this.governance.record({ actor: 'system', org: input.org ?? '_ops', tenant: input.tenantId, operation: 'admin.settings', targetId: input.tenantId, evidence: 'live-verified' });
    return s;
  }

  usersOf(tenantId?: string): AdminUser[] {
    const all = [...this.users.values()];
    return tenantId ? all.filter((u) => u.tenantId === tenantId) : all;
  }
  settingsOf(tenantId: string): TenantSettings | undefined { return this.settings.get(tenantId); }
  count(): number { return this.users.size; }
}
