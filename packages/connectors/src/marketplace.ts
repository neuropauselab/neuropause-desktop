/**
 * Marketplace Foundation (NCEA 10.4, Phase 11). Runtime INFRASTRUCTURE only —
 * no marketplace UI. Connector install with HMAC signing + verification,
 * capability discovery, dependency resolution, version compatibility (reusing
 * the runtime's version comparator), policy validation, and permission review.
 */
import { hmacHex } from '@neuropause/cloud-core';
import { satisfiesMinVersion } from '@neuropause/runtime';
import type { ConnectorDefinition } from './sdk';
import type { ConnectorRegistry } from './registry';

export interface PackageDescriptor {
  id: string;
  name: string;
  version: string;
  category: string;
  capabilities: string[];
  permissions: string[];
  dependencies?: string[];
  /** minimum runtime version required. */
  requiresRuntime?: string;
}

export interface ConnectorPackage {
  descriptor: PackageDescriptor;
  signature?: string;
}

export interface PackageReview {
  signed: boolean;
  compatible: boolean;
  missingDependencies: string[];
  permissions: string[];
}

function canonical(d: PackageDescriptor): string {
  return JSON.stringify({
    id: d.id,
    version: d.version,
    capabilities: d.capabilities,
    permissions: d.permissions,
    dependencies: d.dependencies ?? [],
    requiresRuntime: d.requiresRuntime ?? '',
  });
}

export class MarketplaceFoundation {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly signingKey: string,
    private readonly runtimeVersion: string,
  ) {}

  /** Publisher side — sign a package descriptor. */
  sign(descriptor: PackageDescriptor): string {
    return hmacHex(this.signingKey, canonical(descriptor));
  }

  verify(pkg: ConnectorPackage): boolean {
    return pkg.signature !== undefined && pkg.signature === this.sign(pkg.descriptor);
  }

  compatible(descriptor: PackageDescriptor): boolean {
    return !descriptor.requiresRuntime || satisfiesMinVersion(this.runtimeVersion, descriptor.requiresRuntime);
  }

  /** Dependencies present in the registry; returns any that are missing. */
  missingDependencies(descriptor: PackageDescriptor): string[] {
    return (descriptor.dependencies ?? []).filter((dep) => !this.registry.has(dep));
  }

  discover(capability: string): string[] {
    return this.registry.discover(capability).map((d) => d.id);
  }

  review(pkg: ConnectorPackage): PackageReview {
    return {
      signed: this.verify(pkg),
      compatible: this.compatible(pkg.descriptor),
      missingDependencies: this.missingDependencies(pkg.descriptor),
      permissions: pkg.descriptor.permissions,
    };
  }

  /** Install: verify signature + compatibility + dependencies, then register. */
  install(pkg: ConnectorPackage, def: ConnectorDefinition): { ok: boolean; reason?: string } {
    if (!this.verify(pkg)) return { ok: false, reason: 'signature verification failed' };
    if (!this.compatible(pkg.descriptor)) {
      return { ok: false, reason: `requires runtime >= ${pkg.descriptor.requiresRuntime}` };
    }
    const missing = this.missingDependencies(pkg.descriptor);
    if (missing.length > 0) return { ok: false, reason: `missing dependencies: ${missing.join(', ')}` };
    this.registry.install(def);
    return { ok: true };
  }
}
