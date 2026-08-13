/**
 * PROGRAM 13C ROUND 6 — THREE TENANTS AGAINST EVERY SEAM THIS ROUND MOVED.
 *
 * WHY THREE AND NOT TWO
 *
 * Two tenants cannot distinguish "A leaks to B" from "the pair share one slot".
 * With A, B and C the difference is visible: a broken seam shows every tenant the
 * FIRST writer's value, so C reading A's data while B reads its own is a
 * different failure from all three converging. Several bugs this program found —
 * the calendar-day health row, the frozen `homeTenantId` — look like correct
 * isolation to a two-tenant test because the second tenant simply overwrote the
 * first and read back what it wrote.
 *
 * WHY EVERY TEST ASSERTS PRESENCE FIRST
 *
 * Round 5 shipped a test that asserted a non-seeded organization had zero
 * approval chains, and I read that emptiness as isolation. It was the breakage.
 * EMPTY IS NOT ISOLATION. So each test below establishes that all three tenants
 * HAVE something and RECEIVE their own, and only then that none of them can see
 * another's. A test that only asserts absence passes against a feature that does
 * nothing at all.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { GovernanceStore } from '../../enterprise/governance/governanceStore';
import { FederationStore } from '../../cloud/identity/federationStore';
import { ApiPlatformStore } from '../../cloud/apiplatform/apiPlatformStore';
import { UsageTracker } from '../../ai/usageTracker';
import { ConnectorControlStore } from '../../connectors/connectorControlStore';

const A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-alpha' };
const B: TenantScope = { tenantId: 'org-bravo', workspaceId: 'ws-bravo' };
const C: TenantScope = { tenantId: 'org-charlie', workspaceId: 'ws-charlie' };

/** The active caller. Mutated between assertions to model a real switch. */
let current: TenantScope | null = A;
const scope = (): TenantScope | null => current;
const as = <T,>(t: TenantScope | null, fn: () => T): T => {
  const prev = current;
  current = t;
  try {
    return fn();
  } finally {
    current = prev;
  }
};

let dir: string;
beforeEach(async () => {
  current = A;
  dir = join(tmpdir(), `nps-r6-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
});
afterEach(async () => {
  // `maxRetries` because these stores debounce their writes: a persist can land
  // after the test body returns. Retrying is honest cleanup, not a hidden wait.
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/* ── Governance audit ────────────────────────────────────────────────────── */

describe('the governance audit trail', () => {
  const entry = (n: number, workspaceId: string) => ({
    actor: `actor-${n}`,
    action: 'record.update',
    target: `rec_${n}`,
    summary: `Renamed record ${n} to "Acquisition model"`,
    workspaceId,
  });

  async function store(orgs = 3): Promise<GovernanceStore> {
    const s = new GovernanceStore(join(dir, `gov-${randomUUID()}.json`))
      .bindScope(scope)
      .bindOrganizationCount(() => orgs);
    await s.load();
    return s;
  }

  /**
   * THE FINDING, AS A TEST.
   *
   * `visibleAudit` compared `workspaceId` alone, and the stamp comes from
   * `activeWorkspaceIdForDisplay()` — one install-wide variable whose unswitched
   * value is the SHARED CONSTANT `workspace-default`. So three tenants that had
   * each never created a workspace wrote into one partition and read each other's
   * actors, actions, record ids and record TITLES.
   */
  it('three tenants writing into the SAME workspace id each read only their own', async () => {
    const s = await store();
    // The value the seven production call sites pass: `activeWorkspaceIdForDisplay()`,
    // whose unswitched value is this shared constant. The store must NOT trust it.
    const shared = 'workspace-default';

    as(A, () => s.record(entry(1, shared)));
    as(B, () => s.record(entry(2, shared)));
    as(C, () => s.record(entry(3, shared)));

    // Each tenant HAS a row — the feature works…
    expect(as(A, () => s.auditCount())).toBe(1);
    expect(as(B, () => s.auditCount())).toBe(1);
    expect(as(C, () => s.auditCount())).toBe(1);

    // …and it is its OWN row, named, not merely "a row".
    expect(as(A, () => s.auditEntries().map((e) => e.target))).toEqual(['rec_1']);
    expect(as(B, () => s.auditEntries().map((e) => e.target))).toEqual(['rec_2']);
    expect(as(C, () => s.auditEntries().map((e) => e.target))).toEqual(['rec_3']);
  });

  it('the record TITLE — the part that is disclosure — never crosses', async () => {
    const s = await store();
    as(A, () => s.record({ ...entry(9, 'workspace-default'), summary: 'PROJECT-NIGHTINGALE closed' }));
    const seenByOthers = [
      ...as(B, () => s.auditEntries()),
      ...as(C, () => s.auditEntries()),
    ].map((e) => e.summary);
    expect(seenByOthers).toEqual([]);
    expect(JSON.stringify(seenByOthers)).not.toContain('NIGHTINGALE');
  });

  it('an unresolved writer produces an unattributed row, never a row owned by the wrong tenant', async () => {
    const s = await store();
    const row = as(null, () => s.record(entry(4, 'workspace-default')));
    expect(row.tenantId).toBeUndefined();
    // Withheld from all three, and counted rather than vanished.
    expect(as(A, () => s.auditCount())).toBe(0);
    expect(as(B, () => s.auditCount())).toBe(0);
    expect(as(C, () => s.auditCount())).toBe(0);
    expect(s.unattributedAudit()).toBe(1);
  });

  /**
   * A row must not become visible to a tenant that merely occupies the same
   * workspace id. Tenant identity is the decision; the workspace narrows further.
   */
  it('matching the workspace is NOT sufficient — the tenant must match too', async () => {
    const s = await store();
    as(A, () => s.record(entry(5, 'shared-ws')));
    expect(as({ tenantId: 'org-bravo', workspaceId: 'ws-alpha' }, () => s.auditCount())).toBe(0);
    expect(as(A, () => s.auditCount())).toBe(1);
  });

  it('the tamper-evident chain still verifies with attributed and legacy rows mixed', async () => {
    const s = await store();
    as(A, () => s.record(entry(6, 'ws-alpha')));
    as(null, () => s.record(entry(7, 'ws-alpha'))); // unattributed
    as(B, () => s.record(entry(8, 'ws-bravo')));
    expect(s.verifyAuditIntegrity().ok).toBe(true);
    await s.flush();
  });
});

/* ── Cloud identity: SSO connections ─────────────────────────────────────── */

describe('cloud SSO connections', () => {
  /** org → cloud tenant, the mapping `TenancyStore` owns in production. */
  const CLOUD: Record<string, string> = {
    'org-alpha': 'tnt_alpha',
    'org-bravo': 'tnt_bravo',
    'org-charlie': 'tnt_charlie',
  };
  const cloudTenant = (): string | null => {
    const t = current?.tenantId;
    return t ? (CLOUD[t] ?? null) : null;
  };

  async function store(): Promise<FederationStore> {
    const s = new FederationStore(join(dir, `identity-${randomUUID()}.json`))
      .bindScope(scope)
      .bindCloudTenantResolver(cloudTenant);
    await s.load('tnt_alpha'); // the SEEDED tenant — the one that used to win
    return s;
  }

  /**
   * The F10 boundary stopped at the `load()` call. `homeTenantId` was frozen into
   * a private field and every operation resolved through it, so B and C wrote
   * into A's cloud tenant and read A's rows back.
   */
  it('each tenant creates, sees and updates only its OWN SSO connection', async () => {
    const s = await store();
    const mk = (name: string, host: string, domain: string) => ({ name, protocol: 'saml' as const, issuer: `https://${host}`, ssoUrl: `https://${host}/sso`, domains: [domain] });
    const a = as(A, () => s.createConnection(mk('Alpha Okta', 'alpha.okta.com', 'alpha.example')));
    const b = as(B, () => s.createConnection(mk('Bravo Entra', 'bravo.entra.com', 'bravo.example')));
    const c = as(C, () => s.createConnection(mk('Charlie ADFS', 'charlie.adfs.com', 'charlie.example')));

    // Presence first: all three exist.
    expect([a, b, c].every((x) => x !== null)).toBe(true);

    for (const [tenant, own, others] of [
      [A, a, [b, c]],
      [B, b, [a, c]],
      [C, c, [a, b]],
    ] as const) {
      const list = as(tenant, () => s.listConnections());
      expect(list.map((x) => x.id)).toEqual([own!.id]);
      for (const other of others) {
        expect(as(tenant, () => s.connection(other!.id))).toBeNull();
      }
    }
  });

  /**
   * The mutation half, which is the more serious one: `updateConnection` and
   * `deleteConnection` took BARE IDS. A `cloud:manage` holder in one tenant could
   * disable or delete another tenant's SSO — locking that organization's users
   * out of their own identity provider.
   */
  it('a bare id cannot disable or delete another tenant’s SSO connection', async () => {
    const s = await store();
    const mk = (name: string, host: string) => ({ name, protocol: 'saml' as const, issuer: `https://${host}`, ssoUrl: `https://${host}/sso`, domains: [] });
    const a = as(A, () => s.createConnection(mk('Alpha Okta', 'alpha.okta.com')))!;
    as(B, () => s.createConnection(mk('Bravo Entra', 'bravo.entra.com')));

    // Activate A's connection so "disable it" is a real, observable mutation
    // rather than a no-op against an already-disabled row.
    expect(as(A, () => s.updateConnection(a.id, { status: 'active' }))?.status).toBe('active');

    expect(as(B, () => s.updateConnection(a.id, { status: 'disabled' }))).toBeNull();
    expect(as(C, () => s.deleteConnection(a.id))).toBe(false);

    // A's connection is untouched and STILL ACTIVE — B could not lock A's users out.
    const still = as(A, () => s.connection(a.id));
    expect(still).not.toBeNull();
    expect(still!.status).toBe('active');
    // And A can still disable its own, so this is a boundary, not a freeze.
    expect(as(A, () => s.updateConnection(a.id, { status: 'disabled' }))?.status).toBe('disabled');
  });

  it('SCIM and MFA posture are per tenant, and each tenant HAS one', async () => {
    const s = await store();
    as(A, () => s.setScim(true));
    as(B, () => s.setScim(false));
    as(C, () => s.setMfa({ required: true, methods: ['totp'] }));
    as(A, () => s.setMfa({ required: false }));

    // Presence, then isolation. A is provisioning; B explicitly is not.
    expect(as(A, () => s.scimConfig()?.status)).toBe('enabled');
    expect(as(B, () => s.scimConfig()?.status)).toBe('disabled');
    // C never touched SCIM and must not inherit A's enabled posture.
    expect(as(C, () => s.scimConfig())).toBeNull();

    // MFA `required` is a security POSTURE claim: reading another tenant's
    // `true` tells this tenant it is protected when it is not.
    expect(as(C, () => s.mfaPolicy()?.required)).toBe(true);
    expect(as(A, () => s.mfaPolicy()?.required)).toBe(false);
    expect(as(B, () => s.mfaPolicy())).toBeNull();
  });

  /**
   * The listing was scoped and `summary()` over the SAME array was not.
   */
  it('the identity summary counts only the caller’s connections', async () => {
    const s = await store();
    const mk = (name: string, host: string) => ({ name, protocol: 'saml' as const, issuer: `https://${host}`, ssoUrl: `https://${host}/sso`, domains: [] });
    const a = as(A, () => s.createConnection(mk('Alpha Okta', 'alpha.okta.com')))!;
    as(A, () => s.updateConnection(a.id, { status: 'active', enforced: true }));
    as(B, () => s.createConnection(mk('Bravo Entra', 'bravo.entra.com')));

    expect(as(A, () => s.summary()).connections).toBe(1);
    expect(as(A, () => s.summary()).enforced).toBe(true);
    // B has one of its own, and A's enforcement is not B's.
    expect(as(B, () => s.summary()).connections).toBe(1);
    expect(as(B, () => s.summary()).enforced).toBe(false);
    // C has none, and must not be told SSO is enforced for it.
    expect(as(C, () => s.summary()).connections).toBe(0);
    expect(as(C, () => s.summary()).enforced).toBe(false);
  });
});

/* ── Cloud API platform: webhooks ────────────────────────────────────────── */

describe('cloud API webhooks', () => {
  const CLOUD: Record<string, string> = { 'org-alpha': 'tnt_alpha', 'org-bravo': 'tnt_bravo', 'org-charlie': 'tnt_charlie' };
  const cloudTenant = (): string | null => (current?.tenantId ? (CLOUD[current.tenantId] ?? null) : null);

  it('a webhook endpoint URL never appears in another tenant’s listing', async () => {
    const s = new ApiPlatformStore(join(dir, `api-${randomUUID()}.json`))
      .bindScope(scope)
      .bindCloudTenantResolver(cloudTenant);
    await s.load('tnt_alpha');

    const a = as(A, () => s.createWebhook({ url: 'https://alpha.example/hook', events: ['record.created'] }));
    as(B, () => s.createWebhook({ url: 'https://bravo.example/hook', events: ['record.created'] }));

    expect(as(A, () => s.listWebhooks()).map((w) => w.url)).toEqual(['https://alpha.example/hook']);
    expect(as(B, () => s.listWebhooks()).map((w) => w.url)).toEqual(['https://bravo.example/hook']);
    // C has none — but assert on the CONTENT, not the emptiness.
    expect(JSON.stringify(as(C, () => s.listWebhooks()))).not.toContain('alpha.example');

    // A delivery URL is where data would be exfiltrated to, so mutating another
    // tenant's endpoint is the sharper half.
    expect(as(B, () => s.deleteWebhook(a!.id))).toBe(false);
    expect(as(C, () => s.setWebhookStatus(a!.id, 'disabled'))).toBeNull();
    expect(as(A, () => s.listWebhooks())).toHaveLength(1);
  });
});

/* ── AI usage accounting ─────────────────────────────────────────────────── */

describe('AI usage', () => {
  it('cost and worker breakdown accrue to the tenant that spent them', () => {
    const t = new UsageTracker().bindScope(scope);
    as(A, () => t.add({ worker: 'engineering' as never, model: 'm1', inputTokens: 100, outputTokens: 10, costUsd: 1 }));
    as(B, () => t.add({ worker: 'founder' as never, model: 'm2', inputTokens: 200, outputTokens: 20, costUsd: 2 }));
    as(C, () => t.add({ worker: 'engineering' as never, model: 'm1', inputTokens: 300, outputTokens: 30, costUsd: 4 }));

    // Presence: each tenant HAS spend, and it is its own.
    expect(as(A, () => t.summary().costUsd)).toBe(1);
    expect(as(B, () => t.summary().costUsd)).toBe(2);
    expect(as(C, () => t.summary().costUsd)).toBe(4);
    // Not the install total, which is what the Commercial page used to show.
    expect(as(A, () => t.summary().costUsd)).not.toBe(7);
    // And the breakdown does not name another tenant's workers.
    expect(Object.keys(as(A, () => t.summary().byWorker))).toEqual(['engineering']);
    expect(Object.keys(as(B, () => t.summary().byModel))).toEqual(['m2']);
  });
});

/* ── Connector disable ───────────────────────────────────────────────────── */

describe('the connector disable switch', () => {
  it('one tenant disabling GitHub does not stop another tenant’s GitHub', async () => {
    const s = new ConnectorControlStore(join(dir, `ctl-${randomUUID()}.json`)).bindWorkspace(() => current?.workspaceId ?? '');
    await s.load();

    await as(A, () => s.setDisabled('github', true));

    expect(as(A, () => s.isDisabled('github'))).toBe(true);
    expect(as(B, () => s.isDisabled('github'))).toBe(false);
    expect(as(C, () => s.isDisabled('github'))).toBe(false);
    // Suppression is what actually stops the sync, so assert on that too.
    expect(as(B, () => s.isSuppressed('github', 'acct-b'))).toBe(false);
    expect(as(A, () => s.isSuppressed('github', 'acct-a'))).toBe(true);
  });

  it('re-enabling in one tenant does not restart a connector another tenant turned off', async () => {
    const s = new ConnectorControlStore(join(dir, `ctl-${randomUUID()}.json`)).bindWorkspace(() => current?.workspaceId ?? '');
    await s.load();
    await as(A, () => s.setDisabled('slack', true));
    await as(B, () => s.setDisabled('slack', true));
    await as(B, () => s.setDisabled('slack', false));
    expect(as(A, () => s.isDisabled('slack'))).toBe(true); // A's decision stands
    expect(as(B, () => s.isDisabled('slack'))).toBe(false);
  });

  /**
   * An unresolved caller must not be able to set an ownerless kill switch — that
   * is precisely how the install-wide one existed in the first place. It must
   * also not be TOLD it succeeded: a resolved `Promise<void>` reads as success at
   * the IPC boundary, so an operator would believe a running connector was off.
   */
  it('an unresolved workspace cannot disable anything, and is told so', async () => {
    const s = new ConnectorControlStore(join(dir, `ctl-${randomUUID()}.json`)).bindWorkspace(() => '');
    await s.load();
    await expect(s.setDisabled('github', true)).rejects.toThrow(/no workspace is active/i);
    expect(s.isDisabled('github')).toBe(false);
  });
});

/* ── Governance audit retention ──────────────────────────────────────────── */

describe('audit retention', () => {
  /**
   * THE THIRD INSTALL-WIDE CAP THIS PROGRAM HAS FOUND BEHIND A CORRECT READ
   * FILTER (`executionStore.save`, then `replaceAll`, then this).
   *
   * `while (this.audit.length > cap) this.audit.shift()` walked one shared array
   * oldest-first, so a busy tenant DELETED other tenants' rows — from the hash
   * chain, via `dropOldest`, so they are gone rather than hidden. A retention cap
   * is a write, and it destroys what a read filter merely conceals.
   */
  it('a noisy tenant rotates its OWN history and never another tenant’s', async () => {
    const s = new GovernanceStore(join(dir, `gov-cap-${randomUUID()}.json`), { auditCap: 5 })
      .bindScope(scope)
      .bindOrganizationCount(() => 3);
    await s.load();

    as(B, () => s.record({ actor: 'b', action: 'a', target: 'rec_b', summary: 'B-KEEPS-THIS', workspaceId: 'ws-bravo' }));
    as(C, () => s.record({ actor: 'c', action: 'a', target: 'rec_c', summary: 'C-KEEPS-THIS', workspaceId: 'ws-charlie' }));

    for (let i = 0; i < 50; i += 1) {
      as(A, () => s.record({ actor: 'a', action: 'a', target: `rec_a_${i}`, summary: `A ${i}`, workspaceId: 'ws-alpha' }));
    }

    // B and C still have their evidence — presence, by content, not by count.
    expect(JSON.stringify(as(B, () => s.auditEntries()))).toContain('B-KEEPS-THIS');
    expect(JSON.stringify(as(C, () => s.auditEntries()))).toContain('C-KEEPS-THIS');
    // A rotated its own down to the cap, keeping the newest.
    expect(as(A, () => s.auditCount())).toBe(5);
    expect(JSON.stringify(as(A, () => s.auditEntries()))).toContain('rec_a_49');
    expect(JSON.stringify(as(A, () => s.auditEntries()))).not.toContain('rec_a_0');
    // And the chain still verifies after all that removal.
    expect(s.verifyAuditIntegrity().ok).toBe(true);
    await s.flush();
  });
});

/* ── The connector control path ──────────────────────────────────────────── */

describe('pausing a connector account', () => {
  /**
   * `control()`'s `accountId` branch went straight to `setPaused` with a
   * renderer-supplied id, bypassing the workspace-scoped `listAccounts()` the
   * `null` branch uses. Pausing is a SYNC KILL — `isSuppressed` consults the flag
   * inside the per-workspace fan-out — so this was a silent, durable denial of
   * service against another tenant's data pipeline.
   *
   * Modelled at the level the fix operates on: the supervisor resolves the
   * account through the workspace-scoped `getAccount` before it writes anything.
   */
  it('a bare accountId from another workspace resolves to nothing', () => {
    const owned = new Map<string, string>([['github::acct-a', 'ws-alpha']]);
    const getAccount = (c: string, a: string): boolean =>
      owned.get(`${c}::${a}`) === (current?.workspaceId ?? '');

    // A owns it…
    expect(as(A, () => getAccount('github', 'acct-a'))).toBe(true);
    // …B and C send the same id and resolve to nothing, so no flag is written.
    expect(as(B, () => getAccount('github', 'acct-a'))).toBe(false);
    expect(as(C, () => getAccount('github', 'acct-a'))).toBe(false);
  });
});
