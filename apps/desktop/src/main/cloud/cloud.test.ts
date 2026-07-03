import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TenancyStore } from './tenancy/tenancyStore';
import { FederationStore } from './identity/federationStore';
import { evaluateFederation, buildTestAssertion, type IdpAssertion } from './identity/federation';
import { SyncStore } from './sync/syncStore';
import { planSync } from './sync/syncEngine';
import { ApiPlatformStore } from './apiplatform/apiPlatformStore';
import { buildAdminOverview, buildComplianceReport, type AdminInput } from './admin/admin';
import type { CloudRegionId, DataResidency, MfaPolicy, SsoConnection, SyncDomainState } from '@neuropause/shared';

let dir = '';
const openStores: { flush: () => Promise<void> }[] = [];
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'np-cloud-'));
  openStores.length = 0;
});
afterEach(async () => {
  // Let every store finish its background persist before removing the dir, so
  // teardown never races an in-flight atomic rename.
  await Promise.all(openStores.map((s) => s.flush().catch(() => undefined)));
  for (let i = 0; i < 6; i += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

const REGION_RESIDENCY: Record<CloudRegionId, DataResidency> = {
  'us-east': 'us',
  'us-west': 'us',
  'eu-west': 'eu',
  'eu-central': 'eu',
  'ap-south': 'apac',
  'ap-southeast': 'apac',
};

/* ════════════════════════════ Multi-tenant runtime ════════════════════════ */

describe('TenancyStore', () => {
  async function make(): Promise<TenancyStore> {
    const s = new TenancyStore(join(dir, 'tenancy.json'), 'org-default', 'NeuroPause');
    await s.load();
    openStores.push(s);
    return s;
  }

  it('seeds the home tenant plus demo tenants across regions', async () => {
    const s = await make();
    const tenants = s.listTenants();
    expect(tenants.length).toBe(4);
    expect(tenants[0]?.isHome).toBe(true);
    expect(tenants[0]?.name).toBe('NeuroPause');
    expect(s.regions().length).toBe(6);
    const summary = s.summary();
    expect(summary.tenants).toBe(4);
    expect(summary.regions).toBeGreaterThanOrEqual(3);
    expect(summary.projects).toBeGreaterThan(0);
  });

  it('provisions a new tenant with isolation', async () => {
    const s = await make();
    const t = s.createTenant({ name: 'Initech', regionId: 'eu-central', tier: 'business' });
    expect(t.status).toBe('provisioning');
    expect(t.isHome).toBe(false);
    const iso = s.listIsolation().find((i) => i.tenantId === t.id);
    expect(iso?.residency).toBe('eu');
    expect(iso?.encryptionKeyId).toMatch(/^kms_/);
  });

  it('refuses to change the home tenant status', async () => {
    const s = await make();
    const home = s.homeTenant();
    expect(home).not.toBeNull();
    const result = s.setTenantStatus(home!.id, 'suspended');
    expect(result).toBeNull();
    expect(s.homeTenant()?.status).toBe('active');
  });

  it('creates projects and teams under a tenant', async () => {
    const s = await make();
    const home = s.homeTenant()!;
    const p = s.createProject({ tenantId: home.id, name: 'Platform' });
    expect(p?.tenantId).toBe(home.id);
    expect(s.listProjects(home.id).some((x) => x.name === 'Platform')).toBe(true);
    const team = s.createTeam({ tenantId: home.id, name: 'Core' });
    expect(team?.name).toBe('Core');
  });

  it('folds workforce workers onto the home tenant idempotently', async () => {
    const s = await make();
    const home = s.homeTenant()!;
    const refs = [
      { workerId: 'w1', name: 'Engineering AI', role: 'engineering' },
      { workerId: 'w2', name: 'Finance AI', role: 'finance' },
    ];
    s.syncHomeWorkers(refs);
    s.syncHomeWorkers(refs);
    const workers = s.listWorkers(home.id);
    expect(workers.length).toBe(2);
    expect(workers.map((w) => w.workerId).sort()).toEqual(['w1', 'w2']);
  });

  it('persists across reloads', async () => {
    const s = await make();
    s.createTenant({ name: 'Persisted Co', regionId: 'us-west', tier: 'enterprise' });
    await s.flush();
    const s2 = new TenancyStore(join(dir, 'tenancy.json'), 'org-default', 'NeuroPause');
    await s2.load();
    openStores.push(s2);
    expect(s2.listTenants().some((t) => t.name === 'Persisted Co')).toBe(true);
  });
});

/* ════════════════════════════ Identity federation ═════════════════════════ */

function sampleConnection(over: Partial<SsoConnection> = {}): SsoConnection {
  return {
    id: 'sso_1',
    tenantId: 'tnt_home',
    name: 'Okta',
    protocol: 'saml',
    status: 'active',
    issuer: 'http://www.okta.com/exk1',
    entityId: 'https://cloud.neuropause.app/saml/metadata',
    ssoUrl: 'https://neuropause.okta.com/sso',
    clientId: '',
    domains: ['neuropause.app'],
    attributeMapping: { email: 'email', displayName: 'name', role: 'role' },
    enforced: false,
    createdAt: new Date().toISOString(),
    ...over,
  };
}
const NO_MFA: MfaPolicy = { tenantId: 'tnt_home', required: false, methods: ['totp'], graceDays: 7 };
const REQ_MFA: MfaPolicy = { tenantId: 'tnt_home', required: true, methods: ['totp'], graceDays: 0 };

describe('federation engine (pure)', () => {
  it('authenticates a valid assertion and maps attributes', () => {
    const conn = sampleConnection();
    const assertion: IdpAssertion = {
      issuer: conn.issuer,
      audience: conn.entityId,
      subject: 'user-1',
      email: 'jordan@neuropause.app',
      claims: { email: 'jordan@neuropause.app', name: 'Jordan Lee', role: 'admin' },
      mfa: true,
    };
    const res = evaluateFederation(conn, assertion, NO_MFA);
    expect(res.ok).toBe(true);
    expect(res.identity?.mappedRole).toBe('admin');
    expect(res.identity?.displayName).toBe('Jordan Lee');
  });

  it('rejects an issuer mismatch', () => {
    const res = evaluateFederation(sampleConnection(), { issuer: 'evil', subject: 'x', email: 'a@neuropause.app', claims: {} }, NO_MFA);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/issuer/i);
  });

  it('rejects an email domain outside the connection', () => {
    const conn = sampleConnection();
    const res = evaluateFederation(conn, { issuer: conn.issuer, audience: conn.entityId, subject: 'x', email: 'a@elsewhere.com', claims: {} }, NO_MFA);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/domain/i);
  });

  it('enforces MFA when policy requires it', () => {
    const conn = sampleConnection();
    const res = evaluateFederation(conn, { issuer: conn.issuer, audience: conn.entityId, subject: 'x', email: 'a@neuropause.app', claims: {}, mfa: false }, REQ_MFA);
    expect(res.ok).toBe(false);
    expect(res.mfaRequired).toBe(true);
  });

  it('builds a passing test assertion for a connection', () => {
    const conn = sampleConnection();
    const res = evaluateFederation(conn, buildTestAssertion(conn), NO_MFA);
    expect(res.ok).toBe(true);
  });
});

describe('FederationStore', () => {
  async function make(): Promise<FederationStore> {
    const s = new FederationStore(join(dir, 'identity.json'));
    await s.load('tnt_home');
    openStores.push(s);
    return s;
  }

  it('seeds SAML + OIDC connections and a summary', async () => {
    const s = await make();
    const conns = s.listConnections();
    expect(conns.length).toBe(2);
    expect(conns.some((c) => c.protocol === 'saml')).toBe(true);
    expect(conns.some((c) => c.protocol === 'oidc')).toBe(true);
    const summary = s.summary();
    expect(summary.connections).toBe(2);
    expect(summary.active).toBeGreaterThanOrEqual(1);
    expect(summary.scimEnabled).toBe(false);
  });

  it('creates, updates, and deletes a connection', async () => {
    const s = await make();
    const c = s.createConnection({ name: 'Ping', protocol: 'oidc', issuer: 'https://ping', ssoUrl: 'https://ping/auth', domains: ['acme.com'] });
    expect(c.status).toBe('disabled');
    const up = s.updateConnection(c.id, { status: 'active', enforced: true });
    expect(up?.status).toBe('active');
    expect(up?.enforced).toBe(true);
    expect(s.summary().enforced).toBe(true);
    expect(s.deleteConnection(c.id)).toBe(true);
  });

  it('toggles SCIM and records provisioning', async () => {
    const s = await make();
    const on = s.setScim(true);
    expect(on.status).toBe('enabled');
    expect(on.tokenLast4).toHaveLength(4);
    const synced = s.recordScimSync(5);
    expect(synced?.provisioned).toBe(5);
    expect(s.summary().provisionedUsers).toBe(5);
  });

  it('updates the MFA policy', async () => {
    const s = await make();
    const next = s.setMfa({ required: true, methods: ['webauthn'] });
    expect(next.required).toBe(true);
    expect(next.methods).toEqual(['webauthn']);
    expect(s.summary().mfaRequired).toBe(true);
  });
});

/* ════════════════════════════ Cloud synchronization ═══════════════════════ */

describe('sync engine (pure)', () => {
  it('pushes pending, pulls remote, resolves conflicts server-side, advances version', () => {
    const state: SyncDomainState = { domain: 'ai_memory', localVersion: 10, remoteVersion: 10, pendingChanges: 3, status: 'pending', lastSyncedAt: null, cursor: 'ai_memory@10' };
    const result = planSync({
      state,
      localPending: 3,
      remoteChanges: 2,
      conflicts: [{ entityId: 'item-1', field: 'updatedAt', localValue: 'a', remoteValue: 'b' }],
      now: Date.now(),
    });
    expect(result.pushed).toBe(3);
    expect(result.pulled).toBe(2);
    expect(result.fromVersion).toBe(10);
    expect(result.toVersion).toBe(15);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.resolution).toBe('remote');
    expect(result.cursor).toBe('ai_memory@15');
  });
});

describe('SyncStore', () => {
  async function make(): Promise<SyncStore> {
    const s = new SyncStore(join(dir, 'sync.json'));
    await s.load();
    openStores.push(s);
    return s;
  }

  it('seeds all eight domains synced', async () => {
    const s = await make();
    const states = s.states_();
    expect(states.length).toBe(8);
    expect(states.every((x) => x.status === 'synced')).toBe(true);
    expect(s.summary().domains).toBe(8);
  });

  it('records a local change as pending, then clears it on sync', async () => {
    const s = await make();
    s.recordLocalChange('templates', 2);
    const before = s.states_().find((x) => x.domain === 'templates')!;
    expect(before.pendingChanges).toBe(2);
    expect(before.status).toBe('pending');
    const result = s.syncDomain('templates');
    expect('offline' in result).toBe(false);
    const after = s.states_().find((x) => x.domain === 'templates')!;
    expect(after.pendingChanges).toBe(0);
    expect(after.status).toBe('synced');
  });

  it('queues sync while offline and resumes online', async () => {
    const s = await make();
    s.setOnline(false);
    expect(s.summary().online).toBe(false);
    s.recordLocalChange('governance', 1);
    const offline = s.syncDomain('governance');
    expect('offline' in offline).toBe(true);
    s.setOnline(true);
    const result = s.syncDomain('governance');
    expect('offline' in result).toBe(false);
  });

  it('records a conflict when local and remote both changed', async () => {
    const s = await make();
    s.recordLocalChange('ai_memory', 1);
    s.syncDomain('ai_memory'); // tick 0→1, remoteDelta>0 for this domain index
    expect(s.listConflicts().length).toBeGreaterThanOrEqual(1);
  });

  it('runs a full sync and stamps lastFullSyncAt', async () => {
    const s = await make();
    const results = s.syncAll();
    expect(results.length).toBe(8);
    expect(s.summary().lastFullSyncAt).not.toBeNull();
  });
});

/* ════════════════════════════ Enterprise API platform ═════════════════════ */

describe('ApiPlatformStore', () => {
  async function make(): Promise<ApiPlatformStore> {
    const s = new ApiPlatformStore(join(dir, 'api.json'));
    await s.load('tnt_home');
    openStores.push(s);
    return s;
  }

  it('seeds deployments, policies, a webhook, and public APIs', async () => {
    const s = await make();
    expect(s.listDeployments().length).toBe(3);
    expect(s.listPolicies().length).toBe(3);
    expect(s.listWebhooks().length).toBe(1);
    expect(s.listPublicApis().length).toBe(3);
    const summary = s.summary(50_000);
    expect(summary.deployments).toBe(3);
    expect(summary.requests30d).toBe(50_000);
    expect(summary.replicas).toBeGreaterThan(0);
    expect(summary.uptimePct).toBeGreaterThan(0);
  });

  it('creates and tests a webhook', async () => {
    const s = await make();
    const w = s.createWebhook({ url: 'https://acme.test/hook', events: ['sync.completed'] });
    expect(w.deliveries).toBe(0);
    const tested = s.testWebhook(w.id);
    expect(tested?.deliveries).toBe(1);
    expect(tested?.lastDeliveryAt).not.toBeNull();
    const paused = s.setWebhookStatus(w.id, 'paused');
    expect(paused?.status).toBe('paused');
    expect(s.deleteWebhook(w.id)).toBe(true);
  });

  it('toggles a rate-limit policy', async () => {
    const s = await make();
    const policy = s.listPolicies()[0]!;
    const off = s.setPolicyEnabled(policy.id, false);
    expect(off?.enabled).toBe(false);
  });
});

/* ════════════════════════════ Enterprise administration ═══════════════════ */

function sampleAdminInput(): AdminInput {
  return {
    tenants: [
      { id: 'tnt_home', name: 'NeuroPause', slug: 'neuropause', organizationId: 'org-default', regionId: 'us-east', tier: 'enterprise', status: 'active', isHome: true, storageNamespace: 'np-home', createdAt: new Date().toISOString() },
      { id: 'tnt_helios', name: 'Helios', slug: 'helios', organizationId: 'org-helios', regionId: 'eu-west', tier: 'enterprise', status: 'active', isHome: false, storageNamespace: 'np-helios', createdAt: new Date().toISOString() },
    ],
    isolation: [
      { tenantId: 'tnt_home', tenantName: 'NeuroPause', namespace: 'np-home', encryptionKeyId: 'kms_1', regionId: 'us-east', residency: 'us', objects: 12_000, bytes: 300_000_000 },
      { tenantId: 'tnt_helios', tenantName: 'Helios', namespace: 'np-helios', encryptionKeyId: 'kms_2', regionId: 'eu-west', residency: 'eu', objects: 180_000, bytes: 5_000_000_000 },
    ],
    homeTenantId: 'tnt_home',
    homeUsers: [
      { id: 'u1', name: 'Saurabh', email: 'saurabh@neuropause.app', role: 'Founder', isWorker: false },
      { id: 'u2', name: 'Engineering AI', email: '', role: 'engineering', isWorker: true },
    ],
    homeMonthly: 499,
    identity: { connections: 2, active: 1, enforced: true, scimEnabled: true, mfaRequired: true, provisionedUsers: 8 },
    apiRequests30d: 120_000,
    syncOps30d: 340,
    activeWorkers: 9,
    regionResidency: REGION_RESIDENCY,
    now: Date.now(),
  };
}

describe('admin rollup (pure)', () => {
  it('builds tenant rows, users, usage, and billing', () => {
    const overview = buildAdminOverview(sampleAdminInput());
    expect(overview.tenants.length).toBe(2);
    const home = overview.tenants.find((t) => t.tenantId === 'tnt_home')!;
    expect(home.monthlySpend).toBe(499);
    expect(overview.billing.totalMonthly).toBe(499 + 499);
    expect(overview.billing.currency).toBe('USD');
    expect(overview.usage.storageBytes).toBe(300_000_000 + 5_000_000_000);
    expect(overview.usage.activeWorkers).toBe(9);
    expect(overview.users.some((u) => u.name === 'Saurabh')).toBe(true);
  });

  it('builds a compliance report with controls, score, and residency', () => {
    const report = buildComplianceReport(sampleAdminInput());
    expect(report.controls.length).toBe(6);
    expect(report.controls.some((c) => c.framework === 'SOC 2')).toBe(true);
    expect(report.controls.some((c) => c.framework === 'GDPR')).toBe(true);
    expect(report.controls.some((c) => c.framework === 'ISO 27001')).toBe(true);
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.residencyByRegion.length).toBeGreaterThanOrEqual(2);
  });

  it('warns on access control when neither SSO enforcement nor MFA is on', () => {
    const input = sampleAdminInput();
    input.identity = { ...input.identity, enforced: false, mfaRequired: false };
    const report = buildComplianceReport(input);
    const access = report.controls.find((c) => c.id === 'soc2-cc6.1')!;
    expect(access.status).toBe('warn');
  });
});
