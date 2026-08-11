/**
 * PROGRAM 13C ROUND 4 — regressions for what the SWEEP found, after the
 * federation rewrite was already done and its own A/B/C suite was green.
 *
 * Two of these are in code written the same session. One of them — F1 — was
 * being USED BY the certification suite to reach its preconditions, which is
 * the most instructive failure in this program so far: a test that exploits a
 * hole to set itself up cannot detect that hole, and it will pass forever.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { FederationRuntimeStore } from '../../federation/runtime/fedStore';
import { ExchangeStore } from '../../federation/exchange/exchangeStore';
import { GlobalGovStore } from '../../federation/governance/globalGovStore';
import { PacksStore } from '../../ecosystem/exchange/packsStore';

const A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-bravo', workspaceId: 'ws-b' };
const C: TenantScope = { tenantId: 'org-charlie', workspaceId: 'ws-c' };

let scope: TenantScope | null = A;
let dir: string;

beforeEach(async () => {
  dir = join(tmpdir(), `np-fed-sweep-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  scope = A;
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

const src = (): TenantScope | null => scope;

/* ── F1: the sender cannot accept its own invitation ────────────────────── */

describe('F1 — an invitation needs the RECIPIENT’s consent', () => {
  async function makeFed(): Promise<FederationRuntimeStore> {
    const f = new FederationRuntimeStore(join(dir, 'fed.json'), 'org-default', 'Default').bindScope(src);
    await f.load();
    return f;
  }

  /**
   * THE ATTACK, IN TWO IPC CALLS.
   *
   * `inviteOrg` derives the target id from a caller-supplied display NAME, so C
   * can address an invitation to `org-default` — the install's primary
   * organization — by typing "Default". If the sender may also accept, C holds
   * a full-trust relationship with an organization that never agreed to one:
   * its directory row is overwritten with attacker-chosen values, and every
   * `partner`-scoped artifact it ever published becomes visible to C.
   */
  it('C cannot invite the primary organization and then accept on its behalf', async () => {
    const fed = await makeFed();
    scope = C;
    const invite = fed.inviteOrg({ name: 'Default', trustLevel: 'full' });
    expect(invite.toOrg).toBe('org-default');

    expect(fed.respondInvitation(invite.id, true)).toBeNull();
    expect(fed.listTrust()).toEqual([]);

    // And the target's own directory row was not rewritten.
    scope = { tenantId: 'org-default', workspaceId: 'ws-d' };
    expect(fed.homeOrg()?.name).toBe('Default');
  });

  it('the RECIPIENT can accept — the gate is not simply "no"', async () => {
    const fed = await makeFed();
    scope = A;
    const invite = fed.inviteOrg({ name: 'Bravo Co', trustLevel: 'full' });
    scope = { tenantId: invite.toOrg, workspaceId: 'ws-p' };
    expect(fed.respondInvitation(invite.id, true)?.status).toBe('accepted');
    expect(fed.listTrust()).toHaveLength(1);
  });

  /** Withdrawing your own invitation is a separate, legitimate authorization. */
  it('the sender may WITHDRAW but not accept', async () => {
    const fed = await makeFed();
    scope = A;
    const invite = fed.inviteOrg({ name: 'Bravo Co', trustLevel: 'full' });
    expect(fed.respondInvitation(invite.id, true)).toBeNull();
    expect(fed.revokeInvitation(invite.id)?.status).toBe('revoked');
  });

  it('a third party can neither accept nor withdraw', async () => {
    const fed = await makeFed();
    scope = A;
    const invite = fed.inviteOrg({ name: 'Bravo Co', trustLevel: 'full' });
    scope = C;
    expect(fed.respondInvitation(invite.id, true)).toBeNull();
    expect(fed.revokeInvitation(invite.id)).toBeNull();
  });

  /** Declining is a recipient action too, and must stay available to them. */
  it('the recipient may decline', async () => {
    const fed = await makeFed();
    scope = A;
    const invite = fed.inviteOrg({ name: 'Bravo Co', trustLevel: 'full' });
    scope = { tenantId: invite.toOrg, workspaceId: 'ws-p' };
    expect(fed.respondInvitation(invite.id, false)?.status).toBe('declined');
  });
});

/* ── F2: every write path redacts ───────────────────────────────────────── */

describe('F2 — no artifact response carries another organization’s installs', () => {
  async function makeExchange(): Promise<ExchangeStore> {
    const e = new ExchangeStore(join(dir, 'ex.json'))
      .bindScope(src)
      .bindTrustResolver(() => false)
      .bindRegionResolver(() => null);
    await e.load();
    return e;
  }

  /**
   * `rate()` is open to any organization that can SEE an artifact — which is
   * what made it the reachable one. It used `visible()` as a boolean and then
   * re-read the raw map entry, so a five-star rating on any public package
   * returned a cross-customer list of who had installed it.
   */
  it('rate() does not leak the installer list', async () => {
    const ex = await makeExchange();
    scope = A;
    const art = ex.publish({ kind: 'connector_pack', name: 'P', summary: 's', scope: 'public', publisherOrgName: 'Alpha' });
    scope = B;
    ex.install(art.id);

    scope = C;
    const rated = ex.rate(art.id, 5);
    expect(rated).not.toBeNull();
    expect(rated?.installations).toEqual([]);
    expect(JSON.stringify(rated)).not.toContain(B.tenantId);
  });

  it('nor do publishVersion / setVerification / setScope / rollback', async () => {
    const ex = await makeExchange();
    scope = A;
    const art = ex.publish({ kind: 'ai_worker', name: 'W', summary: 's', scope: 'public', publisherOrgName: 'Alpha' });
    scope = B;
    ex.install(art.id);

    scope = A; // the publisher — and it must not see WHICH orgs installed either
    for (const result of [
      ex.publishVersion(art.id, '2.0.0', 'v2'),
      ex.setVerification(art.id, 'verified'),
      ex.setScope(art.id, 'partner'),
      ex.rollback(art.id),
    ]) {
      expect(result?.installations).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(B.tenantId);
    }
  });
});

/* ── F3: recordAction cannot name an arbitrary organization ─────────────── */

describe('F3 — governance cannot be written into a stranger’s audit trail', () => {
  async function makeGov(related: (peer: string) => boolean): Promise<GlobalGovStore> {
    const g = new GlobalGovStore(join(dir, 'gov.json'), 'org-default', 'Default')
      .bindScope(src)
      .bindPeerResolver(related);
    await g.load();
    return g;
  }

  /**
   * Every other write in that store checks membership on an EXISTING record.
   * `recordAction` CREATES the record and let the payload choose the second
   * party — so one call wrote attacker-controlled text permanently into an
   * unrelated organization's federated audit trail, and a self-authored
   * `require_approval` policy then inserted a pending approval into its queue.
   */
  it('C cannot record an action against an organization it does not federate with', async () => {
    const gov = await makeGov(() => false);
    scope = C;
    expect(() =>
      gov.recordAction({
        action: 'cross_org_run',
        peerOrg: A.tenantId,
        peerOrgName: 'HOSTILE',
        trustLevel: 'full',
        detail: 'injected',
      }),
    ).toThrow(/not a federation peer/i);

    scope = A;
    expect(gov.listAudit()).toEqual([]);
    expect(gov.listApprovals()).toEqual([]);
  });

  it('a real peer CAN — the gate is not simply "no"', async () => {
    const gov = await makeGov(() => true);
    scope = C;
    expect(() =>
      gov.recordAction({ action: 'publish_public', peerOrg: A.tenantId, peerOrgName: 'Alpha', trustLevel: 'full', detail: 'ok' }),
    ).not.toThrow();
  });

  it('the audit records the CALLER as actor, not the seeded organization', async () => {
    const gov = (await makeGov(() => true)).bindActorNameResolver(() => 'Charlie Inc');
    scope = C;
    gov.recordAction({ action: 'publish_public', peerOrg: A.tenantId, peerOrgName: 'Alpha', trustLevel: 'full', detail: 'ok' });
    const mine = gov.listAudit();
    expect(mine[0]?.actorOrg).toBe(C.tenantId);
    expect(mine[0]?.actorOrgName).toBe('Charlie Inc');
  });
});

/* ── F9: packs ──────────────────────────────────────────────────────────── */

describe('F9 — exchange packs are owner-scoped', () => {
  async function makePacks(): Promise<PacksStore> {
    const p = new PacksStore(join(dir, 'packs.json'), 'org-default', 'Default').bindScope(src);
    await p.load();
    return p;
  }

  it('C cannot list A’s packs', async () => {
    const packs = await makePacks();
    scope = A;
    packs.publish({ name: 'Alpha Pack', summary: 's', kind: 'knowledge', items: [] });
    scope = C;
    expect(packs.list()).toEqual([]);
  });

  /** The sharpest write here: an unrecoverable cross-tenant delete. */
  it('C cannot REMOVE A’s pack by its id', async () => {
    const packs = await makePacks();
    scope = A;
    const pack = packs.publish({ name: 'Alpha Pack', summary: 's', kind: 'knowledge', items: [] });
    scope = C;
    expect(packs.remove(pack.id)).toBe(false);
    scope = A;
    expect(packs.list()).toHaveLength(1);
  });

  it('C cannot IMPORT A’s pack, and A can remove its own', async () => {
    const packs = await makePacks();
    scope = A;
    const pack = packs.publish({ name: 'Alpha Pack', summary: 's', kind: 'knowledge', items: [] });
    scope = C;
    expect(packs.importPack(pack.id)).toBeNull();
    scope = A;
    expect(packs.remove(pack.id)).toBe(true);
  });

  it('publisherOrgId is the CALLER, not the seeded organization', async () => {
    const packs = await makePacks();
    scope = B;
    expect(packs.publish({ name: 'B Pack', summary: 's', kind: 'knowledge', items: [] }).publisherOrgId).toBe(B.tenantId);
  });

  it('an unresolved caller sees nothing and cannot publish', async () => {
    const packs = await makePacks();
    scope = A;
    packs.publish({ name: 'Alpha Pack', summary: 's', kind: 'knowledge', items: [] });
    scope = null;
    expect(packs.list()).toEqual([]);
    expect(() => packs.publish({ name: 'x', summary: 's', kind: 'knowledge', items: [] })).toThrow(/no owner/i);
  });
});
