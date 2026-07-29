/**
 * Asset-backed EPIC platforms — container (E2), Kubernetes (E3), Helm (E4), release pipeline (E6),
 * configuration (E8), monitoring stack (E10), storage (E12), network (E13), and documentation (E16).
 * Each is a thin reader over the real AssetCatalog: it derives its answers from files that actually
 * exist on disk, using dependency-free parsing (regex / JSON.parse). Manifests are REPRESENTED only;
 * no cluster, service, or resource is claimed to be running.
 */
import type { AssetCatalog } from './assets';

export class ContainerPlatform {
  constructor(private readonly catalog: AssetCatalog) {}
  /** Multi-stage Dockerfile build targets, read from the real Dockerfile. */
  dockerfileTargets(): string[] {
    const raw = this.catalog.read('docker/Dockerfile');
    return [...raw.matchAll(/\bAS\s+([\w-]+)/gi)].map((m) => m[1]!);
  }
  /** Compose service names for a given compose file (development or production). */
  composeServices(relPath = 'docker/docker-compose.yml'): string[] {
    const raw = this.catalog.read(relPath);
    const start = raw.indexOf('\nservices:');
    const end = raw.indexOf('\nvolumes:');
    const section = raw.slice(start < 0 ? 0 : start, end < 0 ? undefined : end);
    return [...section.matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]!);
  }
  count(): number { return this.catalog.list('compose').length + this.catalog.list('dockerfile').length; }
}

export class KubernetesPlatform {
  constructor(private readonly catalog: AssetCatalog) {}
  manifests(): string[] { return this.catalog.byEpic('E3').map((a) => a.path); }
  /** Distinct Kubernetes resource kinds present across the manifests (represented, not deployed). */
  resourceKinds(): string[] {
    const kinds = new Set<string>();
    for (const a of this.catalog.byEpic('E3')) {
      for (const m of this.catalog.read(a.path).matchAll(/^kind:\s*([A-Za-z]+)/gm)) kinds.add(m[1]!);
    }
    return [...kinds].sort();
  }
  note(): string { return 'manifests only — no cluster is claimed to exist'; }
  count(): number { return this.catalog.byEpic('E3').length; }
}

export class HelmPlatform {
  constructor(private readonly catalog: AssetCatalog) {}
  chartVersion(): string {
    const m = this.catalog.read('helm/nems/Chart.yaml').match(/^version:\s*(.+)$/m);
    return m ? m[1]!.trim() : '';
  }
  valuesEnvironments(): string[] {
    return this.catalog.list('helm-values').map((a) => a.path.replace(/^.*values-?/, '').replace('.yaml', '') || 'default');
  }
  templates(): string[] { return this.catalog.list('helm-template').map((a) => a.path); }
  count(): number { return this.catalog.byEpic('E4').length; }
}

export class ReleasePipeline {
  constructor(private readonly catalog: AssetCatalog) {}
  workflows(): string[] { return this.catalog.list('github-workflow').map((a) => a.path.replace('github-workflows/', '')); }
  count(): number { return this.catalog.list('github-workflow').length; }
}

export class ConfigurationPlatform {
  constructor(private readonly catalog: AssetCatalog) {}
  environments(): string[] { return this.catalog.list('config').map((a) => a.path.replace('config/', '').replace('.json', '')); }
  config(environment: string): Record<string, unknown> {
    return JSON.parse(this.catalog.read(`config/${environment}.json`)) as Record<string, unknown>;
  }
  count(): number { return this.catalog.list('config').length; }
}

export class MonitoringStack {
  constructor(private readonly catalog: AssetCatalog) {}
  components(): string[] { return this.catalog.list('monitoring').map((a) => a.path.replace('monitoring/', '')); }
  note(): string { return 'monitoring configuration only — no running Prometheus/Grafana/Loki is claimed'; }
  count(): number { return this.catalog.list('monitoring').length; }
}

export class StoragePlatform {
  constructor(private readonly catalog: AssetCatalog) {}
  adapters(): string[] {
    const cfg = JSON.parse(this.catalog.read('storage/storage.config.json')) as { objectStorage: { adapters: Array<{ provider: string }> } };
    return cfg.objectStorage.adapters.map((a) => a.provider);
  }
  count(): number { return this.catalog.list('storage').length; }
}

export class NetworkArchitecture {
  constructor(private readonly catalog: AssetCatalog) {}
  hasEdgeConfig(): boolean { return this.catalog.exists('network/nginx.conf'); }
  features(): string[] {
    const raw = this.catalog.read('network/nginx.conf');
    const f: string[] = [];
    if (/listen 443 ssl/.test(raw)) f.push('tls');
    if (/return 301 https/.test(raw)) f.push('https-redirect');
    if (/limit_req_zone/.test(raw)) f.push('rate-limiting');
    if (/proxy_pass/.test(raw)) f.push('reverse-proxy');
    if (/Strict-Transport-Security/.test(raw)) f.push('hsts');
    return f;
  }
}

export class DocumentationCatalog {
  constructor(private readonly catalog: AssetCatalog) {}
  guides(): string[] { return this.catalog.list('documentation').map((a) => a.path.replace('docs/', '').replace('.md', '')); }
  count(): number { return this.catalog.list('documentation').length; }
}
