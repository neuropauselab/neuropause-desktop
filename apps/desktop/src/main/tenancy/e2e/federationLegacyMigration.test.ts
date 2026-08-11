/**
 * PROGRAM 13C ROUND 5 — F6. THE MIGRATION MUST NOT FAIL OPEN.
 *
 * Round 4 gave federation records an owner and filtered every read on it. For
 * trust and shares that fails CLOSED: a pre-Round-4 row has no owner, so nobody
 * sees it. Availability suffers; nothing leaks.
 *
 * For GOVERNANCE POLICIES the same filter fails OPEN, and it took a sweep to
 * notice because nothing looks wrong when it happens:
 *
 *   an unowned policy → dropped from listPolicies()
 *                     → recordAction() evaluates the remaining list
 *                     → a pre-existing DENY rule silently stops being enforced
 *                     → and setPolicyEnabled filters on the same list, so
 *                       nobody can turn it back on
 *
 * A control that stops working on upgrade, silently, is worse than a control
 * that was never there: the operator believes they still have it.
 *
 * THE FIX IS NOT AN ATTRIBUTION.
 *
 * The tempting migration is "stamp legacy rows with the seeded organization".
 * On a single-organization install that is even true. But `addPolicy` stamped
 * no owner and ANY tenant could call it, so the data contains no evidence of
 * who authored a given row — and inventing one is the single thing a migration
 * must never do. So: quarantine, count, surface, and fail closed on enforcement
 * until a human resolves it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { GlobalGovStore } from '../../federation/governance/globalGovStore';

const A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-bravo', workspaceId: 'ws-b' };

let scope: TenantScope | null = A;
let dir: string;
let file: string;

beforeEach(async () => {
  dir = join(tmpdir(), `np-fedmig-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  file = join(dir, 'gov.json');
  scope = A;
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/**
 * Write a governance file in the PRE-ROUND-4 shape: policies with no `ownerOrg`
 * at all. This is what an upgrading install actually has on disk.
 */
async function writeLegacyFile(policies: { id: string; effect: string; action: string; name: string }[]): Promise<void> {
  await fs.writeFile(
    file,
    JSON.stringify({
      policies: policies.map((p) => ({
        id: p.id,
        name: p.name,
        description: 'legacy',
        scope: 'all',
        effect: p.effect,
        action: p.action,
        enabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
      approvals: [],
      audit: [],
      seeded: true,
    }),
    'utf8',
  );
}

async function open(): Promise<GlobalGovStore> {
  const g = new GlobalGovStore(file, 'org-seed', 'Seed')
    .bindScope(() => scope)
    .bindPeerResolver(() => true);
  await g.load();
  return g;
}

/* ── The fail-open itself ───────────────────────────────────────────────── */

describe('F6 — a legacy DENY rule cannot silently stop being enforced', () => {
  /**
   * THE REGRESSION FOR THE ACTUAL DEFECT.
   *
   * Before this fix the assertion below was `'allow'`: the deny rule was
   * invisible, so evaluation saw an empty policy set and permitted the action.
   */
  it('an unattributed DENY rule forces approval rather than vanishing into allow', async () => {
    await writeLegacyFile([
      { id: 'fpol_legacy_deny', name: 'No cross-org runs', effect: 'deny', action: 'cross_org_run' },
    ]);
    const gov = await open();

    scope = A;
    const result = gov.recordAction({
      action: 'cross_org_run',
      peerOrg: B.tenantId,
      peerOrgName: 'Bravo',
      trustLevel: 'full',
      detail: 'x',
    });

    expect(result.decision).not.toBe('allow');
    expect(result.decision).toBe('require_approval');
    expect(result.reason).toMatch(/predate tenant attribution/i);
  });

  it('the legacy row is COUNTED, so its existence is undeniable', async () => {
    await writeLegacyFile([
      { id: 'fpol_a', name: 'One', effect: 'deny', action: 'x' },
      { id: 'fpol_b', name: 'Two', effect: 'allow', action: 'y' },
    ]);
    const gov = await open();
    expect(gov.migrationRequiredCount()).toBe(2);
  });

  /**
   * A count and not a listing. On a multi-organization install these rows may
   * name another tenant's actions, and surfacing their existence must not
   * become a disclosure of their contents to whoever asks first.
   */
  it('but it is NOT listed to anybody as their own policy', async () => {
    await writeLegacyFile([{ id: 'fpol_legacy', name: 'SECRET-RULE-NAME', effect: 'deny', action: 'x' }]);
    const gov = await open();
    for (const who of [A, B]) {
      scope = who;
      expect(gov.listPolicies()).toEqual([]);
      expect(JSON.stringify(gov.listPolicies())).not.toContain('SECRET-RULE-NAME');
    }
  });

  it('the fail-closed state lifts once nothing is unattributed', async () => {
    await writeLegacyFile([{ id: 'fpol_legacy', name: 'Legacy', effect: 'allow', action: 'publish_public' }]);
    const gov = await open();

    scope = A;
    expect(gov.recordAction({ action: 'publish_public', peerOrg: B.tenantId, peerOrgName: 'B', trustLevel: 'full', detail: 'x' }).decision)
      .toBe('require_approval');

    expect(gov.discardPolicy('fpol_legacy')).toBe(true);
    expect(gov.migrationRequiredCount()).toBe(0);

    // With no unattributed rows and no owned rules, an action is allowed again.
    expect(gov.recordAction({ action: 'publish_public', peerOrg: B.tenantId, peerOrgName: 'B', trustLevel: 'full', detail: 'x' }).decision)
      .toBe('allow');
  });

  /** A DENY the caller genuinely owns must still deny — fail-closed is not "always approve". */
  it('an OWNED deny rule still denies, and is not softened to require_approval', async () => {
    const gov = await open();
    scope = A;
    gov.addPolicy({ name: 'No runs', description: '', scope: 'all', effect: 'deny', action: 'cross_org_run' });
    expect(gov.recordAction({ action: 'cross_org_run', peerOrg: B.tenantId, peerOrgName: 'B', trustLevel: 'full', detail: 'x' }).decision)
      .toBe('deny');
  });
});

/* ── Claiming ───────────────────────────────────────────────────────────── */

describe('F6 — claiming a legacy policy', () => {
  /**
   * Safe by construction: a policy governs its OWNER'S federated actions, so
   * claiming one can only constrain the claimer. It is not a route to authority
   * over anybody else — the claimer could have written the same rule for itself.
   */
  it('the claimer gets a rule that constrains the CLAIMER', async () => {
    await writeLegacyFile([{ id: 'fpol_legacy', name: 'No runs', effect: 'deny', action: 'cross_org_run' }]);
    const gov = await open();

    scope = A;
    expect(gov.claimPolicy('fpol_legacy')?.ownerOrg).toBe(A.tenantId);
    expect(gov.migrationRequiredCount()).toBe(0);

    // A is now bound by it...
    expect(gov.recordAction({ action: 'cross_org_run', peerOrg: B.tenantId, peerOrgName: 'B', trustLevel: 'full', detail: 'x' }).decision)
      .toBe('deny');

    // ...and B is not. Claiming did not make it install-wide.
    scope = B;
    expect(gov.listPolicies()).toEqual([]);
    expect(gov.recordAction({ action: 'cross_org_run', peerOrg: A.tenantId, peerOrgName: 'A', trustLevel: 'full', detail: 'x' }).decision)
      .toBe('allow');
  });

  it('a claimed policy cannot be claimed again', async () => {
    await writeLegacyFile([{ id: 'fpol_legacy', name: 'R', effect: 'deny', action: 'x' }]);
    const gov = await open();
    scope = A;
    expect(gov.claimPolicy('fpol_legacy')).not.toBeNull();
    scope = B;
    expect(gov.claimPolicy('fpol_legacy')).toBeNull();
  });

  it('an already-owned policy is not claimable, and an unresolved caller claims nothing', async () => {
    const gov = await open();
    scope = A;
    const owned = gov.addPolicy({ name: 'Mine', description: '', scope: 'all', effect: 'deny', action: 'x' });
    scope = B;
    expect(gov.claimPolicy(owned.id)).toBeNull();

    scope = null;
    expect(gov.claimPolicy('anything')).toBeNull();
    expect(gov.discardPolicy('anything')).toBe(false);
  });

  it('claiming survives a reload — the row is really attributed on disk', async () => {
    await writeLegacyFile([{ id: 'fpol_legacy', name: 'R', effect: 'deny', action: 'cross_org_run' }]);
    const gov = await open();
    scope = A;
    gov.claimPolicy('fpol_legacy');
    await gov.flush();

    const reopened = await open();
    expect(reopened.migrationRequiredCount()).toBe(0);
    scope = A;
    expect(reopened.listPolicies().map((p) => p.id)).toEqual(['fpol_legacy']);
  });
});

/* ── Trust and shares fail CLOSED, and that is the other half ───────────── */

describe('F6 — legacy trust and shares are invisible rather than global', () => {
  /**
   * Stated as a test rather than assumed, because "the other records fail
   * closed" is exactly the kind of claim that turns out to be true for three
   * record types and false for the fourth — which is what F6 was.
   */
  it('an unowned approval is a party to nobody', async () => {
    await fs.writeFile(
      file,
      JSON.stringify({
        policies: [],
        approvals: [{ id: 'appr_legacy', action: 'x', fromOrg: '', fromOrgName: '', toOrg: '', toOrgName: '', status: 'pending', requestedAt: '2026-01-01T00:00:00.000Z', resolvedAt: null, resolver: null }],
        audit: [{ id: 'faud_legacy', at: '2026-01-01T00:00:00.000Z', actorOrg: '', actorOrgName: '', peerOrg: '', peerOrgName: '', action: 'x', decision: 'allow', policyId: null, detail: 'LEGACY-DETAIL' }],
        seeded: true,
      }),
      'utf8',
    );
    const gov = await open();
    for (const who of [A, B]) {
      scope = who;
      expect(gov.listApprovals()).toEqual([]);
      expect(JSON.stringify(gov.listAudit())).not.toContain('LEGACY-DETAIL');
      expect(gov.resolveApproval('appr_legacy', true)).toBeNull();
    }
  });
});
