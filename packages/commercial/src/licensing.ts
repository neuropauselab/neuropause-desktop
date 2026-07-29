/**
 * Module 4 — Licensing Platform. Seat, AI-worker, industry, feature, enterprise, and trial
 * licenses. Seat allocation is REALLY enforced — a license has a finite capacity and allocating
 * beyond it is rejected, not silently allowed. In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';
import { LICENSE_TYPES, type LicenseType } from './constants';

export interface License {
  id: string;
  tenantId: string;
  type: LicenseType;
  seats: number;
  used: number;
  feature?: string;
  active: boolean;
  createdAt: number;
}

export class LicensingPlatform {
  private readonly licenses = new Map<string, License>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CommercialGovernance,
  ) {}

  async issue(input: { tenantId: string; type: LicenseType; seats?: number; feature?: string; org?: string }): Promise<License> {
    if (!LICENSE_TYPES.includes(input.type)) throw new Error(`unknown license type: ${input.type}`);
    const lic: License = { id: randomId('lic'), tenantId: input.tenantId, type: input.type, seats: input.seats ?? 1, used: 0, ...(input.feature ? { feature: input.feature } : {}), active: true, createdAt: this.clock.now() };
    this.licenses.set(lic.id, lic);
    await this.governance.record({ actor: 'system', org: input.org ?? '_ops', tenant: input.tenantId, operation: `license.issue.${input.type}`, targetId: lic.id, evidence: 'live-verified', decision: `${lic.seats} seat(s)` });
    return lic;
  }

  /** Allocate one seat — REALLY enforced: rejects when the license is at capacity or inactive. */
  async allocateSeat(licenseId: string): Promise<License> {
    const lic = this.require(licenseId);
    if (!lic.active) throw new Error('license is not active');
    if (lic.used >= lic.seats) throw new Error('license has no seats remaining');
    lic.used += 1;
    await this.governance.record({ actor: 'system', org: '_ops', tenant: lic.tenantId, operation: 'license.allocate-seat', targetId: lic.id, evidence: 'live-verified', decision: `${lic.used}/${lic.seats}` });
    return lic;
  }

  releaseSeat(licenseId: string): License {
    const lic = this.require(licenseId);
    if (lic.used > 0) lic.used -= 1;
    return lic;
  }
  async revoke(licenseId: string): Promise<License> {
    const lic = this.require(licenseId);
    lic.active = false;
    await this.governance.record({ actor: 'system', org: '_ops', tenant: lic.tenantId, operation: 'license.revoke', targetId: lic.id, evidence: 'live-verified' });
    return lic;
  }

  private require(id: string): License {
    const lic = this.licenses.get(id);
    if (!lic) throw new Error(`no license ${id}`);
    return lic;
  }

  get(id: string): License | undefined { return this.licenses.get(id); }
  list(tenantId?: string): License[] {
    const all = [...this.licenses.values()];
    return tenantId ? all.filter((l) => l.tenantId === tenantId) : all;
  }
  seatsIssued(tenantId?: string): number { return this.list(tenantId).reduce((s, l) => s + l.seats, 0); }
  count(): number { return this.licenses.size; }
}
