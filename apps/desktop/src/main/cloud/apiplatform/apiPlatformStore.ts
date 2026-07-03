/**
 * The enterprise API platform store: the API gateway deployed as a cloud service
 * across regions with high-availability replicas, rate-limit policies, webhook
 * endpoints, and the public API registry.
 *
 * Honest seam: the deployments + replica health are a modeled control-plane view
 * (the gateway decision engine from Phase 8 runs in-process today); monitoring
 * request counts are sourced from the real gateway metrics. Webhook delivery is
 * simulated. Electron-free.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  ApiDeployment,
  ApiPlatformSummary,
  CloudRateLimitPolicy,
  CloudRegionId,
  PublicApi,
  WebhookEndpoint,
  WebhookStatus,
} from '@neuropause/shared';
import { createLogger } from '../../logger';

const log = createLogger('cloud-apiplatform');

interface ApiPlatformFile {
  deployments: ApiDeployment[];
  policies: CloudRateLimitPolicy[];
  webhooks: WebhookEndpoint[];
  apis: PublicApi[];
  seeded: boolean;
}

export class ApiPlatformStore extends EventEmitter {
  private deployments = new Map<string, ApiDeployment>();
  private policies = new Map<string, CloudRateLimitPolicy>();
  private webhooks = new Map<string, WebhookEndpoint>();
  private apis = new Map<string, PublicApi>();

  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  private homeTenantId = '';

  constructor(private readonly filePath: string) {
    super();
  }

  async load(homeTenantId: string): Promise<void> {
    if (this.loaded) return;
    this.homeTenantId = homeTenantId;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<ApiPlatformFile>;
      for (const d of data.deployments ?? []) if (d?.id) this.deployments.set(d.id, d);
      for (const p of data.policies ?? []) if (p?.id) this.policies.set(p.id, p);
      for (const w of data.webhooks ?? []) if (w?.id) this.webhooks.set(w.id, w);
      for (const a of data.apis ?? []) if (a?.id) this.apis.set(a.id, a);
      if (!data.seeded || this.deployments.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Cloud API platform ready', { deployments: this.deployments.size, webhooks: this.webhooks.size, apis: this.apis.size });
  }

  private applySeed(): void {
    const now = new Date().toISOString();
    const deploy = (regionId: CloudRegionId, replicas: number, healthy: number, p95: number, uptime: number): void => {
      const id = `dep_${randomUUID()}`;
      this.deployments.set(id, {
        id,
        service: 'api-gateway',
        regionId,
        replicas,
        healthyReplicas: healthy,
        status: healthy === replicas ? 'healthy' : healthy === 0 ? 'down' : 'degraded',
        version: 'v1',
        uptimePct: uptime,
        p95LatencyMs: p95,
        deployedAt: now,
      });
    };
    deploy('us-east', 3, 3, 42, 99.98);
    deploy('eu-west', 2, 2, 51, 99.95);
    deploy('ap-south', 2, 1, 73, 99.71);

    const policy = (name: string, scope: CloudRateLimitPolicy['scope'], windowSec: number, limit: number, burst: number): void => {
      const id = `rlp_${randomUUID()}`;
      this.policies.set(id, { id, name, scope, windowSec, limit, burst, enabled: true });
    };
    policy('Global ceiling', 'global', 60, 10_000, 2_000);
    policy('Per-tenant', 'tenant', 60, 1_000, 200);
    policy('Per-key default', 'key', 60, 100, 20);

    const wid = `whk_${randomUUID()}`;
    this.webhooks.set(wid, {
      id: wid,
      tenantId: this.homeTenantId,
      url: 'https://hooks.neuropause.app/inbound',
      events: ['listing.published', 'sync.completed', 'governance.violation'],
      status: 'active',
      secretLast4: randomUUID().slice(0, 4),
      deliveries: 1_284,
      failures: 3,
      lastDeliveryAt: new Date(Date.now() - 1_800_000).toISOString(),
      createdAt: now,
    });

    const api = (name: string, basePath: string, visibility: PublicApi['visibility'], scopes: string[], rps: number): void => {
      const id = `api_${randomUUID()}`;
      this.apis.set(id, { id, name, basePath, version: 'v1', visibility, scopes, rps });
    };
    api('Marketplace API', '/v1/marketplace', 'public', ['marketplace:read', 'marketplace:publish'], 240);
    api('Workforce API', '/v1/workers', 'partner', ['workers:read', 'workers:manage'], 90);
    api('Admin API', '/v1/admin', 'private', ['billing:read', 'usage:read'], 30);
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const payload: ApiPlatformFile = {
      deployments: [...this.deployments.values()],
      policies: [...this.policies.values()],
      webhooks: [...this.webhooks.values()],
      apis: [...this.apis.values()],
      seeded: true,
    };
    await fs.writeFile(tmp, JSON.stringify(payload), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drain();
  }
  private async drain(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('API platform persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  listDeployments(): ApiDeployment[] {
    return [...this.deployments.values()].sort((a, b) => a.regionId.localeCompare(b.regionId));
  }
  listPolicies(): CloudRateLimitPolicy[] {
    return [...this.policies.values()];
  }
  listWebhooks(): WebhookEndpoint[] {
    return [...this.webhooks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  listPublicApis(): PublicApi[] {
    return [...this.apis.values()];
  }

  summary(requests30d: number): ApiPlatformSummary {
    const deps = [...this.deployments.values()];
    const replicas = deps.reduce((n, d) => n + d.replicas, 0);
    const healthyReplicas = deps.reduce((n, d) => n + d.healthyReplicas, 0);
    return {
      deployments: deps.length,
      healthy: deps.filter((d) => d.status === 'healthy').length,
      regions: new Set(deps.map((d) => d.regionId)).size,
      replicas,
      uptimePct: replicas > 0 ? Math.round((healthyReplicas / replicas) * 10_000) / 100 : 0,
      requests30d,
      webhooks: this.webhooks.size,
      publicApis: this.apis.size,
    };
  }

  createWebhook(input: { url: string; events: string[] }): WebhookEndpoint {
    const id = `whk_${randomUUID()}`;
    const webhook: WebhookEndpoint = {
      id,
      tenantId: this.homeTenantId,
      url: input.url,
      events: input.events,
      status: 'active',
      secretLast4: randomUUID().slice(0, 4),
      deliveries: 0,
      failures: 0,
      lastDeliveryAt: null,
      createdAt: new Date().toISOString(),
    };
    this.webhooks.set(id, webhook);
    this.schedulePersist();
    this.emit('changed');
    return webhook;
  }

  setWebhookStatus(id: string, status: WebhookStatus): WebhookEndpoint | null {
    const w = this.webhooks.get(id);
    if (!w) return null;
    const next: WebhookEndpoint = { ...w, status };
    this.webhooks.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  deleteWebhook(id: string): boolean {
    const ok = this.webhooks.delete(id);
    if (ok) {
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }

  /** Simulate a webhook test delivery. */
  testWebhook(id: string): WebhookEndpoint | null {
    const w = this.webhooks.get(id);
    if (!w) return null;
    const next: WebhookEndpoint = { ...w, deliveries: w.deliveries + 1, lastDeliveryAt: new Date().toISOString(), status: w.status === 'failing' ? 'active' : w.status };
    this.webhooks.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  setPolicyEnabled(id: string, enabled: boolean): CloudRateLimitPolicy | null {
    const p = this.policies.get(id);
    if (!p) return null;
    const next: CloudRateLimitPolicy = { ...p, enabled };
    this.policies.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }
}
