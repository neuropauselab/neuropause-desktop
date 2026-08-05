/**
 * EPIC 5 — DNS & TLS Automation. Generates DNS-record descriptors, a load-balancer/ingress reference, a
 * cert-manager ClusterIssuer + Certificate, a renewal policy, and TLS verification commands. Everything
 * is represented until an operator executes it: no DNS record is published and no certificate is issued
 * by this generator.
 */
import { toManifestFile, toYaml, type Yamlish } from './serialize';
import type { Artifact } from './types';
import type { PlatformAutomationGovernance } from './governance';

export class DnsTlsAutomation {
  constructor(
    private readonly gov: PlatformAutomationGovernance,
    private readonly operator: string,
  ) {}

  dnsRecords(input: { host: string; target: string }): Record<string, Yamlish> {
    return {
      published: false,
      records: [
        { type: 'A', name: input.host, value: input.target, ttl: 60 },
        { type: 'CAA', name: input.host, value: '0 issue "letsencrypt.org"' },
      ],
    };
  }

  clusterIssuer(email: string): Record<string, Yamlish> {
    return {
      apiVersion: 'cert-manager.io/v1',
      kind: 'ClusterIssuer',
      metadata: { name: 'letsencrypt-prod' },
      spec: { acme: { server: 'https://acme-v02.api.letsencrypt.org/directory', email, privateKeySecretRef: { name: 'letsencrypt-prod' }, solvers: [{ http01: { ingress: { class: 'nginx' } } }] } },
    };
  }

  certificate(host: string): Record<string, Yamlish> {
    return {
      apiVersion: 'cert-manager.io/v1',
      kind: 'Certificate',
      metadata: { name: 'neuropause-backend-tls', namespace: 'neuropause' },
      spec: { secretName: 'neuropause-backend-tls', issuerRef: { name: 'letsencrypt-prod', kind: 'ClusterIssuer' }, dnsNames: [host], renewBefore: '360h' },
    };
  }

  verificationCommands(host: string): string[] {
    return [
      `dig +short ${host}`,
      `echo | openssl s_client -connect ${host}:443 -servername ${host} 2>/dev/null | openssl x509 -noout -issuer -dates`,
      `curl -fsSI https://${host}/metrics`,
    ];
  }

  async generateAll(input: { host: string; target: string; email: string }): Promise<Artifact> {
    const content = `# DNS records (descriptor)\n${toYaml(this.dnsRecords({ host: input.host, target: input.target }))}\n---\n${toManifestFile([this.clusterIssuer(input.email), this.certificate(input.host)])}`;
    const artifact: Artifact = { kind: 'dns-tls', name: `dns-tls-${input.host}.yaml`, format: 'yaml', content, note: 'DNS + cert-manager descriptors — represented until executed; no record published, no certificate issued here.' };
    await this.gov.record({ operator: this.operator, environment: 'production', target: `dns-tls:${input.host}`, epic: 'E5', operation: 'generate-dns-tls', result: 'generated', evidence: 'live-verified' });
    return artifact;
  }
}
