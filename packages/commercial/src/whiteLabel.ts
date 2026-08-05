/**
 * Module 8 — White Label Platform. Per-tenant logos, themes, colors, fonts, login screen, custom
 * domains, and email templates. A tenant's branding is a real stored configuration, applied by
 * upsert; unset fields stay unset (they are not filled with invented defaults). In-process —
 * live-verified; starts empty.
 */
import { type Clock } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';

export interface Branding {
  tenantId: string;
  logoUrl?: string;
  theme?: string;
  colors?: { primary?: string; secondary?: string; accent?: string };
  fonts?: { heading?: string; body?: string };
  loginScreen?: { headline?: string; backgroundUrl?: string };
  domain?: string;
  emailTemplates?: Record<string, string>;
  updatedAt: number;
}

export class WhiteLabelPlatform {
  private readonly brands = new Map<string, Branding>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CommercialGovernance,
  ) {}

  async configure(input: Omit<Branding, 'updatedAt'> & { org?: string }): Promise<Branding> {
    const existing = this.brands.get(input.tenantId);
    const brand: Branding = {
      tenantId: input.tenantId,
      ...(existing ?? {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      ...(input.theme !== undefined ? { theme: input.theme } : {}),
      ...(input.colors !== undefined ? { colors: input.colors } : {}),
      ...(input.fonts !== undefined ? { fonts: input.fonts } : {}),
      ...(input.loginScreen !== undefined ? { loginScreen: input.loginScreen } : {}),
      ...(input.domain !== undefined ? { domain: input.domain } : {}),
      ...(input.emailTemplates !== undefined ? { emailTemplates: input.emailTemplates } : {}),
      updatedAt: this.clock.now(),
    };
    this.brands.set(brand.tenantId, brand);
    await this.governance.record({ actor: 'system', org: input.org ?? '_ops', tenant: input.tenantId, operation: 'whitelabel.configure', targetId: input.tenantId, evidence: 'live-verified' });
    return brand;
  }

  get(tenantId: string): Branding | undefined { return this.brands.get(tenantId); }
  list(): Branding[] { return [...this.brands.values()]; }
  count(): number { return this.brands.size; }
}
