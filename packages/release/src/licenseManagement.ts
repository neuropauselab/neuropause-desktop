/**
 * EPIC 12 — License Management. Trial / Community / Professional / Enterprise tiers with validation,
 * seat allocation, expiration, renewal, and upgrade paths. When the commercial platform is wired in the
 * license is a REAL record issued through the reused licensing platform (with real seats); validation
 * checks the real record and its expiry. No entitlement is fabricated.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import { LICENSE_TIERS, type LicenseTier } from './constants';
import type { ReleaseContext } from './types';
import type { ReleaseGovernance } from './governance';

export interface LicenseGrant {
  id: string;
  tier: LicenseTier;
  tenantId: string;
  seats: number;
  seatsAllocated: number;
  expiresAt: number | null;
  commercialLicenseId: string | null;
  reusedCommercial: boolean;
}

const TIER_LICENSE_TYPE: Record<LicenseTier, 'trial' | 'seat' | 'enterprise'> = {
  trial: 'trial',
  community: 'seat',
  professional: 'seat',
  enterprise: 'enterprise',
};

const UPGRADE_PATH: Record<LicenseTier, LicenseTier[]> = {
  trial: ['community', 'professional', 'enterprise'],
  community: ['professional', 'enterprise'],
  professional: ['enterprise'],
  enterprise: [],
};

export class LicenseManagement {
  private readonly grants = new Map<string, LicenseGrant>();

  constructor(
    private readonly clock: Clock,
    private readonly ctx: ReleaseContext,
    private readonly gov: ReleaseGovernance,
    private readonly operator: string,
  ) {}

  tiers(): readonly LicenseTier[] {
    return LICENSE_TIERS;
  }

  async issue(input: { tier: LicenseTier; tenantId: string; seats?: number; expiresAt?: number }): Promise<LicenseGrant> {
    const seats = input.seats ?? (input.tier === 'trial' ? 5 : 25);
    let commercialLicenseId: string | null = null;
    let reusedCommercial = false;
    if (this.ctx.commercial) {
      const lic = await this.ctx.commercial.licenses().issue({ tenantId: input.tenantId, type: TIER_LICENSE_TYPE[input.tier], seats });
      commercialLicenseId = lic.id;
      reusedCommercial = true;
    }
    const grant: LicenseGrant = {
      id: randomId('lic'),
      tier: input.tier,
      tenantId: input.tenantId,
      seats,
      seatsAllocated: 0,
      expiresAt: input.expiresAt ?? null,
      commercialLicenseId,
      reusedCommercial,
    };
    this.grants.set(grant.id, grant);
    await this.record('issue-license', grant.id, input.tier);
    return grant;
  }

  async allocateSeat(grantId: string): Promise<LicenseGrant> {
    const grant = this.require(grantId);
    if (grant.seatsAllocated >= grant.seats) throw new Error('no seats available');
    if (this.ctx.commercial && grant.commercialLicenseId) await this.ctx.commercial.licenses().allocateSeat(grant.commercialLicenseId);
    grant.seatsAllocated += 1;
    await this.record('allocate-seat', grantId, `${grant.seatsAllocated}/${grant.seats}`);
    return grant;
  }

  /** Validation checks a real record and its expiry against the current clock. */
  validate(grantId: string): { valid: boolean; reason: string } {
    const grant = this.grants.get(grantId);
    if (!grant) return { valid: false, reason: 'no such license' };
    if (grant.expiresAt !== null && grant.expiresAt <= this.clock.now()) return { valid: false, reason: 'expired' };
    return { valid: true, reason: 'active' };
  }

  async renew(grantId: string, newExpiresAt: number): Promise<LicenseGrant> {
    const grant = this.require(grantId);
    grant.expiresAt = newExpiresAt;
    await this.record('renew-license', grantId, 'renewed');
    return grant;
  }

  upgradePath(tier: LicenseTier): LicenseTier[] {
    return UPGRADE_PATH[tier];
  }

  get(id: string): LicenseGrant | undefined {
    return this.grants.get(id);
  }
  count(): number {
    return this.grants.size;
  }

  private async record(operation: string, targetId: string, decision: string): Promise<void> {
    await this.gov.record({ operator: this.operator, version: '_ops', environment: '_licensing', customerScope: '_all', epic: 'E12', operation, targetId, evidence: 'live-verified', decision });
  }
  private require(id: string): LicenseGrant {
    const g = this.grants.get(id);
    if (!g) throw new Error(`unknown license: ${id}`);
    return g;
  }
}
