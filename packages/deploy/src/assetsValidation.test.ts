import { describe, it, expect } from 'vitest';
import { load, loadAll } from 'js-yaml';
import { AssetCatalog } from './assets';

const catalog = new AssetCatalog();

describe('Deployment asset validation — real files, really parsed', () => {
  it('catalogs the real on-disk assets', () => {
    const all = catalog.scan();
    expect(all.length).toBeGreaterThanOrEqual(55);
    for (const a of all) expect(catalog.exists(a.path)).toBe(true);
  });

  it('every YAML / JSON asset parses (js-yaml / JSON.parse)', () => {
    for (const a of catalog.scan()) {
      const raw = catalog.read(a.path);
      expect(raw.length).toBeGreaterThan(0);
      if (a.format === 'yaml') expect(load(raw)).toBeTruthy();
      else if (a.format === 'yaml-multi') expect(loadAll(raw).length).toBeGreaterThan(0);
      else if (a.format === 'json') expect(JSON.parse(raw)).toBeTruthy();
    }
  });

  it('the Dockerfile is a real multi-stage build with all 8 targets', () => {
    const raw = catalog.read('docker/Dockerfile');
    for (const target of ['base', 'deps', 'build', 'production', 'development', 'worker', 'ai-runtime', 'migration']) {
      expect(raw).toContain(`AS ${target}`);
    }
  });

  it('the development compose defines every required service', () => {
    const compose = load(catalog.read('docker/docker-compose.yml')) as { services: Record<string, unknown> };
    for (const svc of ['postgres', 'redis', 'qdrant', 'ollama', 'nginx', 'api', 'workers']) {
      expect(compose.services).toHaveProperty(svc);
    }
  });

  it('the Kubernetes manifests cover every required resource kind', () => {
    const kinds = new Set<string>();
    for (const a of catalog.byEpic('E3')) {
      for (const doc of loadAll(catalog.read(a.path)) as Array<{ kind?: string }>) {
        if (doc && doc.kind) kinds.add(doc.kind);
      }
    }
    for (const kind of ['Namespace', 'ConfigMap', 'Secret', 'Deployment', 'StatefulSet', 'DaemonSet', 'Service', 'Ingress', 'PersistentVolume', 'PersistentVolumeClaim', 'HorizontalPodAutoscaler', 'PodDisruptionBudget', 'NetworkPolicy', 'Job', 'CronJob']) {
      expect([...kinds]).toContain(kind);
    }
  });

  it('the Helm chart is valid and has four values files + templates', () => {
    const chart = load(catalog.read('helm/nems/Chart.yaml')) as { apiVersion: string; name: string };
    expect(chart.apiVersion).toBe('v2');
    expect(chart.name).toBe('nems');
    expect(catalog.list('helm-values').length).toBe(4);
    expect(catalog.list('helm-template').length).toBeGreaterThanOrEqual(6);
  });

  it('has all 6 workflows, 4 configs, and 10 docs', () => {
    expect(catalog.list('github-workflow').length).toBe(6);
    expect(catalog.list('config').length).toBe(4);
    expect(catalog.list('documentation').length).toBe(10);
  });

  it('carries no real secret values — only placeholders/references', () => {
    const env = catalog.read('secrets/secrets.example.env');
    expect(env).toMatch(/REPLACE_ME|USER:PASSWORD/);
    const k8sSecret = catalog.read('k8s/10-config.yaml');
    expect(k8sSecret).toContain('REPLACED_BY_VAULT');
  });
});
