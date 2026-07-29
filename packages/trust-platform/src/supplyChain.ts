/**
 * EPIC 6 — Software Supply Chain Security. Build provenance, artifact verification, a dependency
 * inventory, an SBOM registry, package integrity, and release verification. Build provenance and release
 * verification REUSE the Sprint-6 Release platform (real package artifacts with checksums — each honestly
 * flagged built:false until a production build runs — and the real RC-validation report). The SBOM is
 * generated from the dependency inventory actually registered, and package integrity is a REAL SHA-256
 * comparison. No provenance attestation from a build system that has not run is ever fabricated.
 */
import { sha256Hex } from '@neuropause/cloud-core';
import type { TpContext } from './types';
import type { TrustGovernance } from './governance';

export interface ProvenanceRecord {
  target: string;
  version: string;
  checksum: string;
  built: boolean;
  note: string;
}
export interface ProvenanceResult {
  version: string;
  artifacts: ProvenanceRecord[];
  reusedRelease: boolean;
}
export interface SbomComponent {
  name: string;
  version: string;
  checksum: string | null;
}
export interface Sbom {
  version: string;
  format: 'CycloneDX-like';
  componentCount: number;
  components: SbomComponent[];
}
export interface ReleaseVerification {
  version: string;
  passed: boolean;
  executed: number;
  readinessScore: number | null;
  reusedRelease: boolean;
  note: string;
}

export class SupplyChainSecurity {
  private readonly components = new Map<string, SbomComponent>();

  constructor(
    private readonly ctx: TpContext,
    private readonly gov: TrustGovernance,
    private readonly operator: string,
  ) {}

  /** Build provenance — REUSES the Release packaging runtime's real artifacts (checksums, built:false). */
  async buildProvenance(version: string): Promise<ProvenanceResult> {
    if (this.ctx.release) {
      const artifacts = await this.ctx.release.packaging().buildAll(version);
      const records: ProvenanceRecord[] = artifacts.map((a) => ({ target: String(a.target), version: a.version, checksum: a.checksum, built: a.built, note: a.note }));
      await this.gov.record({ actor: this.operator, environment: '_supply-chain', resource: 'artifacts', policy: 'build-provenance', epic: 'E6', operation: 'build-provenance', targetId: version, evidence: 'live-verified', decision: `${records.length} artifacts` });
      return { version, artifacts: records, reusedRelease: true };
    }
    await this.gov.record({ actor: this.operator, environment: '_supply-chain', resource: 'artifacts', policy: 'build-provenance', epic: 'E6', operation: 'build-provenance', targetId: version, evidence: 'infrastructure-pending', decision: 'no release platform' });
    return { version, artifacts: [], reusedRelease: false };
  }

  /** Release verification — REUSES the Release RC-validation report (real, reused reliability). */
  async verifyRelease(version: string): Promise<ReleaseVerification> {
    if (this.ctx.release) {
      const report = await this.ctx.release.rcValidation().validate({ version });
      await this.gov.record({ actor: this.operator, environment: '_supply-chain', resource: 'release', policy: 'release-verification', epic: 'E6', operation: 'verify-release', targetId: version, evidence: 'live-verified', decision: report.passed ? 'passed' : 'failed' });
      return { version, passed: report.passed, executed: report.executed, readinessScore: report.readinessScore, reusedRelease: true, note: 'validated via the reused Release RC-validation runtime' };
    }
    return { version, passed: false, executed: 0, readinessScore: null, reusedRelease: false, note: 'no Release platform wired in — verification represented until configured' };
  }

  /** Register a dependency-inventory component (feeds the SBOM). */
  async addComponent(input: { name: string; version: string; checksum?: string }): Promise<SbomComponent> {
    const component: SbomComponent = { name: input.name, version: input.version, checksum: input.checksum ?? null };
    this.components.set(`${input.name}@${input.version}`, component);
    await this.gov.record({ actor: this.operator, environment: '_supply-chain', resource: input.name, policy: 'dependency-inventory', epic: 'E6', operation: 'add-component', targetId: `${input.name}@${input.version}`, evidence: 'live-verified', decision: 'inventoried' });
    return component;
  }

  /** Generate an SBOM from the registered inventory — real, deterministic. */
  generateSbom(version: string): Sbom {
    const components = [...this.components.values()];
    return { version, format: 'CycloneDX-like', componentCount: components.length, components };
  }

  /** Package integrity — a REAL SHA-256 comparison of provided content against an expected checksum. */
  verifyIntegrity(input: { name: string; content: string; expectedChecksum: string }): { name: string; valid: boolean; computed: string } {
    const computed = sha256Hex(input.content);
    return { name: input.name, valid: computed === input.expectedChecksum, computed };
  }

  componentCount(): number {
    return this.components.size;
  }
}
