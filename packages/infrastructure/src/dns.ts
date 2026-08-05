/**
 * EPIC 5 — DNS & Networking. DNS/domain/subdomain registry, reverse proxy, ingress controller, load
 * balancer registry, TLS/certificate registry, network topology, and traffic policies. Everything is
 * REPRESENTED: a domain is not resolved, a load balancer is not provisioned, and a TLS certificate
 * is NOT issued (issued=false) until a real CA and DNS exist. Infrastructure-pending until then.
 */
import { randomId } from '@neuropause/cloud-core';
import type { InfraGovernance } from './governance';

export interface DomainRecord { id: string; domain: string; subdomains: string[]; resolved: boolean }
export interface LoadBalancerRecord { id: string; name: string; provisioned: boolean }
export interface TlsRecord { id: string; domain: string; issued: boolean }

export class DnsNetworking {
  private readonly domains = new Map<string, DomainRecord>();
  private readonly loadBalancers = new Map<string, LoadBalancerRecord>();
  private readonly tls = new Map<string, TlsRecord>();

  constructor(private readonly governance: InfraGovernance) {}

  async registerDomain(input: { domain: string; subdomains?: string[]; org?: string }): Promise<DomainRecord> {
    const d: DomainRecord = { id: randomId('dns'), domain: input.domain, subdomains: input.subdomains ?? [], resolved: false };
    this.domains.set(d.id, d);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', epic: 'E5', operation: 'dns.domain', targetId: d.id, evidence: 'infrastructure-pending' });
    return d;
  }

  async registerLoadBalancer(input: { name: string; org?: string }): Promise<LoadBalancerRecord> {
    const lb: LoadBalancerRecord = { id: randomId('lb'), name: input.name, provisioned: false };
    this.loadBalancers.set(lb.id, lb);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', epic: 'E5', operation: 'network.load-balancer', targetId: lb.id, evidence: 'infrastructure-pending' });
    return lb;
  }

  /** Register a TLS certificate slot — issued=false until a real CA issues it. */
  async registerTls(input: { domain: string; org?: string }): Promise<TlsRecord> {
    const c: TlsRecord = { id: randomId('tls'), domain: input.domain, issued: false };
    this.tls.set(c.id, c);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', epic: 'E5', operation: 'network.tls', targetId: c.id, evidence: 'infrastructure-pending' });
    return c;
  }

  topology(): { domains: number; subdomains: number; loadBalancers: number; tls: number; note: string } {
    const subdomains = [...this.domains.values()].reduce((s, d) => s + d.subdomains.length, 0);
    return { domains: this.domains.size, subdomains, loadBalancers: this.loadBalancers.size, tls: this.tls.size, note: 'topology represented — no DNS resolved, no LB provisioned, no certificate issued' };
  }

  domainList(): DomainRecord[] { return [...this.domains.values()]; }
  loadBalancerList(): LoadBalancerRecord[] { return [...this.loadBalancers.values()]; }
  tlsList(): TlsRecord[] { return [...this.tls.values()]; }
  issuedCertificates(): number { return [...this.tls.values()].filter((c) => c.issued).length; }
  count(): number { return this.domains.size; }
}
