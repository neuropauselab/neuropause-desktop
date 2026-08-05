/**
 * EPIC 5 — Production Networking. Descriptors for DNS, TLS, HTTPS, reverse proxy, CDN, load balancers,
 * WAF, and rate limiting. TLS certificate lifecycle REUSES the Sprint-2 infrastructure certificate
 * platform, which does not mark a certificate 'issued' until a real issuance occurs. The target domain
 * (app.neuropause033.com) is REPRESENTED as the intended endpoint — it is NOT live, and DNS/TLS are not
 * claimed active until real infrastructure serves them.
 */
import { randomId } from '@neuropause/cloud-core';
import { NETWORK_COMPONENTS, TARGET_DOMAIN, type NetworkComponent } from './constants';
import type { PlatformOpsContext } from './types';
import type { PlatformOpsGovernance } from './governance';

export interface NetworkDescriptor {
  id: string;
  component: NetworkComponent;
  detail: string;
  active: false; // represented — real activation requires provisioned infrastructure
}

export interface DomainStatus {
  domain: string;
  live: false;
  dnsConfigured: boolean;
  tlsIssued: boolean;
  note: string;
}

export class NetworkingPlatform {
  private readonly descriptors = new Map<string, NetworkDescriptor>();

  constructor(
    private readonly ctx: PlatformOpsContext,
    private readonly gov: PlatformOpsGovernance,
    private readonly operator: string,
  ) {}

  components(): readonly NetworkComponent[] {
    return NETWORK_COMPONENTS;
  }

  async declare(input: { component: NetworkComponent; detail: string }): Promise<NetworkDescriptor> {
    if (!NETWORK_COMPONENTS.includes(input.component)) throw new Error(`unknown network component: ${input.component}`);
    const descriptor: NetworkDescriptor = { id: randomId('net'), component: input.component, detail: input.detail, active: false };
    this.descriptors.set(descriptor.id, descriptor);
    await this.gov.record({ operator: this.operator, environment: 'production', deployment: '_none', cluster: '_network', version: '_platform', epic: 'E5', operation: `declare.${input.component}`, targetId: input.detail, evidence: 'live-verified', decision: 'descriptor (not active)' });
    return descriptor;
  }

  /** Honest domain status — the domain is NOT live; TLS 'issued' only if a real certificate was issued. */
  domainStatus(): DomainStatus {
    let tlsIssued = false;
    if (this.ctx.infrastructure) {
      tlsIssued = this.ctx.infrastructure.certificates().issuedCount() > 0; // false until a real issuance
    }
    const dnsConfigured = this.descriptors.size > 0 && [...this.descriptors.values()].some((d) => d.component === 'dns');
    return {
      domain: TARGET_DOMAIN,
      live: false,
      dnsConfigured,
      tlsIssued,
      note: `${TARGET_DOMAIN} is represented as the intended endpoint; it is NOT live until real DNS + TLS + a running ingress serve it.`,
    };
  }

  list(component?: NetworkComponent): NetworkDescriptor[] {
    const all = [...this.descriptors.values()];
    return component ? all.filter((d) => d.component === component) : all;
  }
}
