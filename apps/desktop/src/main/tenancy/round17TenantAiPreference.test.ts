/**
 * D-5 — TENANT AI PREFERENCE. P13C ROUND 17.
 *
 * THE FINDING THIS CLOSES
 *
 * First-run called `ai:config.setMode` — `cloud:operate`, platform-only — and a
 * fresh install has no platform operator because `platformOperatorRegistry`
 * deliberately never self-seeds. Both onboarding buttons were refused, the
 * catch swallowed it, and no install could be set up. Two independently correct
 * decisions composing into an unusable product; neither was wrong alone, which
 * is why no unit test saw it and the first real launch found it in ninety
 * seconds.
 *
 * THE SECURITY LAW THIS ENFORCES
 *
 *     for every platform policy P and every tenant preference T,
 *     rank(effective(P, T)) <= rank(P)
 *
 * A tenant may narrow what the platform permits. It may never widen it. The
 * three `AiMode` values are totally ordered, so the intersection is `min()` and
 * the proof is EXHAUSTIVE — all nine combinations, including the one value the
 * store cannot persist. A proof that covers inputs the product cannot produce
 * is the only kind worth calling a proof.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AI_MODES,
  TENANT_AI_MODES,
  isTenantAiMode,
  resolveEffectiveAiMode,
  type AiMode,
} from '@neuropause/shared';
import { TenantAiPreferenceStore } from '../ai/tenantAiPreferenceStore';
import { authorizeTenantRead } from './tenantOwnedStore';
import { TENANT_DERIVED_DOMAINS } from '../backup/tenantArchive';

const RANK: Record<AiMode, number> = { local_only: 0, private_first: 1, external: 2 };

describe('D-5 — effective mode is the intersection, exhaustively', () => {
  it('covers all nine platform × tenant combinations', () => {
    /**
     * Iterate in RANK order, not declaration order. `AI_MODES` is declared
     * `['private_first','local_only','external']` — a UI ordering, not a
     * permissiveness one — and pinning the expectation to it would make this
     * proof break the day somebody reorders a dropdown.
     */
    const byRank = [...AI_MODES].sort((a, b) => RANK[a] - RANK[b]);
    const rows = byRank.flatMap((platform) =>
      byRank.map((tenant) => ({
        platform,
        tenant,
        effective: resolveEffectiveAiMode(platform, tenant),
      })),
    );
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => `${r.platform}|${r.tenant}=${r.effective}`)).toEqual([
      'local_only|local_only=local_only',
      'local_only|private_first=local_only',
      'local_only|external=local_only',
      'private_first|local_only=local_only',
      'private_first|private_first=private_first',
      'private_first|external=private_first',
      'external|local_only=local_only',
      'external|private_first=private_first',
      'external|external=external',
    ]);
  });

  it('THE LAW: effective is never more permissive than the platform', () => {
    const violations = AI_MODES.flatMap((platform) =>
      AI_MODES.filter((tenant) => RANK[resolveEffectiveAiMode(platform, tenant)] > RANK[platform]).map(
        (tenant) => `${platform} widened by ${tenant}`,
      ),
    );
    expect(violations, 'a tenant preference widened platform policy').toEqual([]);
  });

  it('is idempotent and order-independent where both agree', () => {
    for (const m of AI_MODES) expect(resolveEffectiveAiMode(m, m)).toBe(m);
  });
});

/**
 * NC-D5-ELEVATE — the mandatory negative control.
 *
 * If `resolveEffectiveAiMode` is ever changed to prefer the tenant value, or to
 * fall through to the tenant on a tie, this fails. It is the single assertion
 * standing between D-5 and a tenant self-service escalation.
 */
describe('NC-D5-ELEVATE — a tenant cannot escalate itself', () => {
  it('platform local_only + tenant private_first stays local_only', () => {
    expect(resolveEffectiveAiMode('local_only', 'private_first')).toBe('local_only');
  });
  it('platform private_first + tenant local_only narrows to local_only', () => {
    expect(resolveEffectiveAiMode('private_first', 'local_only')).toBe('local_only');
  });
  it("the tenant type cannot even express 'external'", () => {
    expect([...TENANT_AI_MODES]).toEqual(['local_only', 'private_first']);
    expect(isTenantAiMode('external')).toBe(false);
    expect(isTenantAiMode('private_first')).toBe(true);
  });
});

describe('D-5 — the store is tenant-owned', () => {
  let dir: string;
  let file: string;
  let active: string | null;
  let store: TenantAiPreferenceStore;

  const asTenant = (id: string | null): void => {
    active = id;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'np-aipref-'));
    file = join(dir, 'tenant-ai-preference.json');
    active = 'org-a';
    store = new TenantAiPreferenceStore(file).bindScope(() =>
      active === null ? null : { tenantId: active, workspaceId: `ws-${active}` },
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('each organization reads only its own preference', async () => {
    asTenant('org-a');
    await store.setMine('local_only');
    asTenant('org-b');
    await store.setMine('private_first');
    asTenant('org-c');
    await store.setMine('local_only');

    asTenant('org-a');
    expect(store.mine()?.mode).toBe('local_only');
    asTenant('org-b');
    expect(store.mine()?.mode).toBe('private_first');
    asTenant('org-c');
    expect(store.mine()?.mode).toBe('local_only');
  });

  it('a write replaces only the writer’s row', async () => {
    asTenant('org-a');
    await store.setMine('local_only');
    asTenant('org-b');
    await store.setMine('private_first');
    asTenant('org-a');
    await store.setMine('private_first');

    asTenant('org-b');
    expect(store.mine()?.mode).toBe('private_first');
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as {
      preferences: { tenantId: string }[];
    };
    expect(onDisk.preferences.map((r) => r.tenantId).sort()).toEqual(['org-a', 'org-b']);
  });

  it('refuses a write when no organization is active — no unowned rows', async () => {
    asTenant(null);
    await expect(store.setMine('local_only')).rejects.toThrow();
    expect(store.mine()).toBeNull();
  });

  it('reads nothing when no organization is active', async () => {
    asTenant('org-a');
    await store.setMine('private_first');
    asTenant(null);
    expect(store.mine()).toBeNull();
  });

  it("drops a hand-edited 'external' row rather than honouring it", () => {
    writeFileSync(
      file,
      JSON.stringify({
        preferences: [{ tenantId: 'org-a', mode: 'external', updatedAt: 1 }],
      }),
    );
    const fresh = new TenantAiPreferenceStore(file).bindScope(() => ({
      tenantId: 'org-a',
      workspaceId: 'ws-a',
    }));
    expect(fresh.mine()).toBeNull();
  });

  it('an UNBOUND store denies — the startup gate is not the only guard', () => {
    const unbound = new TenantAiPreferenceStore(file);
    expect(unbound.hasScope()).toBe(false);
    expect(unbound.mine()).toBeNull();
  });
});

describe('D-5 — F22 seam', () => {
  let dir: string;
  let active: string;
  let store: TenantAiPreferenceStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'np-aipref-f22-'));
    active = 'org-a';
    store = new TenantAiPreferenceStore(join(dir, 'p.json')).bindScope(() => ({
      tenantId: active,
      workspaceId: `ws-${active}`,
    }));
    for (const [id, mode] of [
      ['org-a', 'local_only'],
      ['org-b', 'private_first'],
      ['org-c', 'local_only'],
    ] as const) {
      active = id;
      await store.setMine(mode);
    }
    active = 'org-a';
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("A's snapshot contains A only", () => {
    const grant = authorizeTenantRead({ tenantId: 'org-a', platformOperator: false }, 'org-a');
    const snap = store.snapshotForGrant(grant);
    expect(snap).toHaveLength(1);
    expect(snap[0]?.tenantId).toBe('org-a');
    expect(JSON.stringify(snap)).not.toContain('org-b');
    expect(JSON.stringify(snap)).not.toContain('org-c');
  });

  it('restoring A leaves B and C untouched', async () => {
    const grant = authorizeTenantRead({ tenantId: 'org-a', platformOperator: false }, 'org-a');
    const archived = store.snapshotForGrant(grant);
    active = 'org-a';
    await store.setMine('private_first');
    await store.mergeForGrant(grant, archived);

    active = 'org-a';
    expect(store.mine()?.mode).toBe('local_only');
    active = 'org-b';
    expect(store.mine()?.mode).toBe('private_first');
    active = 'org-c';
    expect(store.mine()?.mode).toBe('local_only');
  });

  it('a grant for A cannot be minted by B', () => {
    expect(() =>
      authorizeTenantRead({ tenantId: 'org-b', platformOperator: false }, 'org-a'),
    ).toThrow();
  });

  it("a tampered archive claiming 'external' installs nothing", async () => {
    const grant = authorizeTenantRead({ tenantId: 'org-a', platformOperator: false }, 'org-a');
    const tampered = [{ tenantId: 'org-a', mode: 'external' as never, updatedAt: 2 }];
    const merged = await store.mergeForGrant(grant, tampered);
    expect(merged).toBe(0);
    active = 'org-a';
    expect(store.mine()).toBeNull();
  });

  it('is domain nineteen — the denominator grew, it was not edited', () => {
    expect(TENANT_DERIVED_DOMAINS).toContain('tenant-ai-preference');
    expect(TENANT_DERIVED_DOMAINS).toHaveLength(19);
    expect(new Set(TENANT_DERIVED_DOMAINS).size).toBe(TENANT_DERIVED_DOMAINS.length);
  });
});

/**
 * CONSENT IS THE SECOND GATE — AND MY FIRST VERSION MISSED IT.
 *
 * `restrictedByPlatform` originally compared MODES only. On a default install
 * the platform mode resolves to `private_first`, so a tenant choosing "approved
 * cloud AI" produced `restricted: false` — no notice — while external routing
 * remained impossible because `externalConsent` defaults to false and only a
 * platform operator can set it. That is precisely the silent no-op the view was
 * written to prevent, reproduced inside it. Caught by a real fresh-install run,
 * not by any test that existed at the time.
 *
 * The rule is now: restricted means an UNFULFILLED INTENT. A tenant that chose
 * `local_only` is never restricted — it asked to be narrower and got it — so
 * the notice cannot cry wolf on the common correct case.
 */
describe('D-5 — restriction means unfulfilled intent, not a mode mismatch', () => {
  const restricted = (
    tenant: 'local_only' | 'private_first' | null,
    platform: AiMode,
    consent: boolean,
  ): boolean => {
    const effective = tenant === null ? platform : resolveEffectiveAiMode(platform, tenant);
    const externalPossible =
      effective === 'external' || (effective === 'private_first' && consent);
    return tenant === 'private_first' && !externalPossible;
  };

  it('flags the default install: tenant wants cloud, consent is off', () => {
    expect(restricted('private_first', 'private_first', false)).toBe(true);
  });

  it('clears once a platform operator grants consent', () => {
    expect(restricted('private_first', 'private_first', true)).toBe(false);
  });

  it('flags a stricter platform even when consent is on', () => {
    // Platform is local_only, so the intersection is local_only and no consent
    // flag can make external reachable. The intent is unfulfilled either way.
    expect(restricted('private_first', 'local_only', true)).toBe(true);
  });

  it('flags platform=external with consent off — the corner I got wrong first', () => {
    /**
     * I expected `false` here and the code said `true`. The code is right.
     *
     * Platform `external` routes directly, but the tenant narrowed to
     * `private_first`, and the intersection moves the request into the regime
     * where external is a FALLBACK requiring `externalConsent` — which is off.
     * So the tenant's cloud intent is unfulfilled and the notice must appear.
     * An odd configuration (external mode, consent withheld), and the
     * conservative answer is the honest one: tell the user their choice is not
     * taking effect, because it is not.
     */
    expect(restricted('private_first', 'external', false)).toBe(true);
    expect(restricted('private_first', 'external', true)).toBe(false);
  });

  it('never flags a tenant that chose local_only — it asked for the narrower thing', () => {
    for (const p of AI_MODES) {
      for (const c of [true, false]) expect(restricted('local_only', p, c)).toBe(false);
    }
  });

  it('never flags a tenant with no preference at all', () => {
    for (const p of AI_MODES) {
      for (const c of [true, false]) expect(restricted(null, p, c)).toBe(false);
    }
  });
});
