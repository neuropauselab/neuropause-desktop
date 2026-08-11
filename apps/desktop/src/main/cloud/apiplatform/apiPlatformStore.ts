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
import { demoSeedsEnabled } from '../../demoSeed';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';

const log = createLogger('cloud-apiplatform');

interface ApiPlatformFile {
  deployments: ApiDeployment[];
  policies: CloudRateLimitPolicy[];
  webhooks: WebhookEndpoint[];
  apis: PublicApi[];
  seeded: boolean;
}

export class ApiPlatformStore extends EventEmitter {
  /**
   * P13C ROUND 6 — A SPLIT CLASSIFICATION, AND SAYING SO IS THE POINT.
   *
   * WEBHOOKS are tenant records: `WebhookEndpoint` carries a `tenantId`, they
   * hold a customer-supplied URL and secret, and `createWebhook` stamped them
   * with the seeded organization's cloud tenant for every caller. Scoped.
   *
   * DEPLOYMENTS, RATE POLICIES and PUBLIC APIs have NO tenant field of any kind
   * — they describe the control plane's own replicas, regions and published API
   * surface, which is one shared thing on one machine. They are install-level
   * infrastructure and scoping them would be wrong, not merely unnecessary.
   *
   * The store therefore takes a boundary for one half and is declared for the
   * other. A store that is partly tenant data does not get to be classified by
   * its majority.
   */
  private readonly tenancy = new TenantOwnership('cloud-api-webhooks');

  /** Bind the tenant boundary. UNBOUND DENIES for webhooks. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  private callerCloudTenant: () => string | null = () => null;
  bindCloudTenantResolver(resolver: () => string | null): this {
    this.callerCloudTenant = resolver;
    return this;
  }
  /**
   * The caller's cloud tenant, or a refusal.
   *
   * Writes throw where reads return empty — the rule the rest of this program
   * uses. A write with no tenant would have to invent an owner, and the invented
   * one was the seeded organization's.
   */
  private requireCloudTenant(): string {
    const id = this.callerCloudTenant();
    if (id === null || id === '') {
      throw new Error('No organization is active, so this webhook has no owner.');
    }
    return id;
  }

  private mineWebhooks<T extends { tenantId: string }>(rows: readonly T[]): T[] {
    const mineId = this.callerCloudTenant();
    if (mineId === null || mineId === '') return [];
    return rows.filter((r) => r.tenantId === mineId);
  }

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
    // Rate-limit policies are real default configuration (not fabricated telemetry) and always seed.
    const policy = (name: string, scope: CloudRateLimitPolicy['scope'], windowSec: number, limit: number, burst: number): void => {
      const id = `rlp_${randomUUID()}`;
      this.policies.set(id, { id, name, scope, windowSec, limit, burst, enabled: true });
    };
    policy('Global ceiling', 'global', 60, 10_000, 2_000);
    policy('Per-tenant', 'tenant', 60, 1_000, 200);
    policy('Per-key default', 'key', 60, 100, 20);

    // Deployments, the sample webhook, and the sample public APIs carry telemetry (uptime %, p95 latency,
    // delivery counts, rps) that has NO real production source and was being surfaced — even relabeled
    // "live" — through the control plane and the Digital Twin. They are demo fixtures only. A production
    // install starts with no seeded deployments/webhooks/APIs (an honest empty state) until real ones exist.
    if (!demoSeedsEnabled()) return;

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

    const wid = `whk_${randomUUID()}`;
    this.webhooks.set(wid, {
      id: wid,
      // Demo seed, boot only, no caller exists. Stated as the boot value rather
      // than written as `callerCloudTenant() ?? homeTenantId`, because that is
      // the exact expression the note on `createWebhook` says was removed from
      // this file — and a disclaimed pattern still present reads as an oversight.
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
  /** The CALLER'S webhook endpoints. Was every organization's URL and secret. */
  listWebhooks(): WebhookEndpoint[] {
    return this.mineWebhooks([...this.webhooks.values()]);
  }

  /** One webhook, IF the caller's cloud tenant owns it. */
  private myWebhook(id: string): WebhookEndpoint | null {
    const w = this.webhooks.get(id) ?? null;
    return w !== null && this.mineWebhooks([w]).length === 1 ? w : null;
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
      // P13C Round 6 — the caller's, not the install's. `listWebhooks()` was
      // scoped and this count over the same Map was not. See the class header:
      // webhooks are tenant records; deployments and public APIs are not.
      webhooks: this.listWebhooks().length,
      publicApis: this.apis.size,
    };
  }

  createWebhook(input: { url: string; events: string[] }): WebhookEndpoint {
    const id = `whk_${randomUUID()}`;
    const webhook: WebhookEndpoint = {
      id,
      /**
       * P13C ROUND 6 — NO `?? this.homeTenantId` FALLBACK.
       *
       * An unresolved caller creating a webhook used to stamp the SEEDED
       * organization as owner: a delivery endpoint — the thing data is
       * exfiltrated TO — filed under a customer who never asked for it, and
       * visible in that customer's listing. Fabricating ownership to avoid an
       * error is the failure this program keeps finding; `requireCloudTenant()`
       * throws, and an unresolved write is refused rather than misfiled.
       */
      tenantId: this.requireCloudTenant(),
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

  /** setWebhookStatus, for one of the CALLER'S webhooks. Was a bare payload id. */
  setWebhookStatus(id: string, status: WebhookStatus): WebhookEndpoint | null {
    const w = this.myWebhook(id);
    if (!w) return null;
    const next: WebhookEndpoint = { ...w, status };
    this.webhooks.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /** Delete one of the CALLER'S webhooks. Was a bare payload id. */
  deleteWebhook(id: string): boolean {
    if (this.myWebhook(id) === null) return false;
    const ok = this.webhooks.delete(id);
    if (ok) {
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }

  /** Simulate a webhook test delivery. */
  /** testWebhook, for one of the CALLER'S webhooks. Was a bare payload id. */
  testWebhook(id: string): WebhookEndpoint | null {
    const w = this.myWebhook(id);
    if (!w) return null;
    const next: WebhookEndpoint = { ...w, deliveries: w.deliveries + 1, lastDeliveryAt: new Date().toISOString(), status: w.status === 'failing' ? 'active' : w.status };
    this.webhooks.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /**
   * Enable or disable a control-plane rate-limit policy.
   *
   * P13C ROUND 6 — A SHARED CONTROL SURFACE, DECLARED WITH ITS COST.
   *
   * Rate policies carry no tenant field and describe THIS MACHINE'S control plane
   * — one set of limits protecting one process. Scoping them would be wrong in a
   * way that is worse than the exposure: per-tenant limits over a shared runtime
   * are not limits.
   *
   * THE COST, STATED PLAINLY: any `cloud:manage` holder can disable a policy that
   * protects every other tenant on the install — including the seeded
   * `Per-tenant` policy. That is a cross-tenant availability decision, and the
   * only honest reasons to accept it are that the resource genuinely is shared and
   * that `cloud:manage` is an administrator capability, not a member one.
   *
   * This is a DECLARATION, like `installStore`'s and `drStore`'s, not a
   * dismissal. If NeuroPause ever hosts unrelated organizations on one control
   * plane, this needs a platform-operator role above `cloud:manage`, and the
   * declaration stops holding at that moment.
   */
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
