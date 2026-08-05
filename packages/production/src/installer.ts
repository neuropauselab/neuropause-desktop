/**
 * Module 16 — Installer Platform. Generates installer descriptors for Windows, macOS, Linux, Docker,
 * and Kubernetes. Artifacts are REPRESENTED honestly: this records the artifact name, target, and a
 * manifest — it does NOT build or sign a real binary/image (that is a real build-pipeline concern).
 * In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import { INSTALLER_TARGETS, type InstallerTarget } from './constants';

export interface InstallerArtifact {
  id: string;
  target: InstallerTarget;
  version: string;
  artifactName: string;
  built: false; // represented — not actually built/signed here
  note: string;
  at: number;
}

const artifactName = (target: InstallerTarget, version: string): string => {
  switch (target) {
    case 'windows': return `nems-${version}-setup.exe`;
    case 'macos': return `nems-${version}.dmg`;
    case 'linux': return `nems-${version}.AppImage`;
    case 'docker': return `neuropause/nems:${version}`;
    case 'kubernetes': return `nems-${version}-helm.tgz`;
  }
};

export class InstallerPlatform {
  private readonly artifacts = new Map<string, InstallerArtifact>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
  ) {}

  async generate(input: { target: InstallerTarget; version: string; org?: string }): Promise<InstallerArtifact> {
    if (!INSTALLER_TARGETS.includes(input.target)) throw new Error(`unknown installer target: ${input.target}`);
    const a: InstallerArtifact = {
      id: randomId('inst'),
      target: input.target,
      version: input.version,
      artifactName: artifactName(input.target, input.version),
      built: false,
      note: 'installer descriptor represented — the real artifact is produced by the build pipeline, not here',
      at: this.clock.now(),
    };
    this.artifacts.set(a.id, a);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', environment: '_platform', operation: `installer.${input.target}`, targetId: a.id, evidence: 'live-verified', version: input.version });
    return a;
  }

  list(target?: InstallerTarget): InstallerArtifact[] {
    const all = [...this.artifacts.values()];
    return target ? all.filter((a) => a.target === target) : all;
  }
  count(): number { return this.artifacts.size; }
}
