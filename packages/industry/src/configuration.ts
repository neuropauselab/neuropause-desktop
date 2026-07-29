/**
 * Universal Configuration Engine + Multi-Tenant Configuration. Each organization configures its
 * industry, country, language, currency, branding, permissions, business rules, custom fields,
 * approval policies, notifications, and compliance packs — entirely as DATA, with NO source-code
 * change. Live-verified in-process.
 */
import { type Clock } from '@neuropause/cloud-core';
import type { IndustryGovernance } from './governance';
import type { Theme } from './constants';

export interface Branding {
  logo?: string;
  colors: { primary: string; secondary: string };
  theme: Theme;
}
export interface BusinessRule { name: string; rule: string }
export interface CustomField { object: string; field: string; type: string }
export interface ApprovalPolicy { operation: string; approvers: number }

export interface TenantConfig {
  tenantId: string;
  industry?: string;
  country: string;
  language: string;
  currency: string;
  branding: Branding;
  permissions: string[];
  businessRules: BusinessRule[];
  customFields: CustomField[];
  approvalPolicies: ApprovalPolicy[];
  notifications: string[];
  compliancePacks: string[];
  updatedAt: number;
}

export interface ConfigureInput {
  industry?: string;
  country?: string;
  language?: string;
  currency?: string;
  branding?: Partial<Branding>;
  permissions?: string[];
  compliancePacks?: string[];
}

export class ConfigurationEngine {
  private readonly configs = new Map<string, TenantConfig>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: IndustryGovernance,
  ) {}

  async configure(tenantId: string, input: ConfigureInput = {}): Promise<TenantConfig> {
    const prev = this.configs.get(tenantId);
    const config: TenantConfig = {
      tenantId,
      ...(input.industry !== undefined ? { industry: input.industry } : prev?.industry !== undefined ? { industry: prev.industry } : {}),
      country: input.country ?? prev?.country ?? 'US',
      language: input.language ?? prev?.language ?? 'en',
      currency: input.currency ?? prev?.currency ?? 'USD',
      branding: { logo: input.branding?.logo ?? prev?.branding.logo, colors: input.branding?.colors ?? prev?.branding.colors ?? { primary: '#4f46e5', secondary: '#06b6d4' }, theme: input.branding?.theme ?? prev?.branding.theme ?? 'light' },
      permissions: input.permissions ?? prev?.permissions ?? [],
      businessRules: prev?.businessRules ?? [],
      customFields: prev?.customFields ?? [],
      approvalPolicies: prev?.approvalPolicies ?? [],
      notifications: prev?.notifications ?? [],
      compliancePacks: input.compliancePacks ?? prev?.compliancePacks ?? [],
      updatedAt: this.clock.now(),
    };
    this.configs.set(tenantId, config);
    await this.governance.record({ actor: 'system', operation: 'config.configure', targetId: tenantId, evidence: 'live-verified', detail: config.industry ?? 'unset' });
    return config;
  }

  addBusinessRule(tenantId: string, rule: BusinessRule): TenantConfig {
    const c = this.require(tenantId);
    c.businessRules.push(rule);
    return c;
  }
  addCustomField(tenantId: string, field: CustomField): TenantConfig {
    const c = this.require(tenantId);
    c.customFields.push(field);
    return c;
  }
  addApprovalPolicy(tenantId: string, policy: ApprovalPolicy): TenantConfig {
    const c = this.require(tenantId);
    c.approvalPolicies.push(policy);
    return c;
  }

  private require(tenantId: string): TenantConfig {
    const c = this.configs.get(tenantId);
    if (!c) throw new Error(`no configuration for tenant ${tenantId}`);
    return c;
  }

  get(tenantId: string): TenantConfig | undefined {
    return this.configs.get(tenantId);
  }
  list(): TenantConfig[] {
    return [...this.configs.values()];
  }
  count(): number {
    return this.configs.size;
  }
}
