/**
 * PROGRAM 13C ROUND 4 — S-10. FEDERATION, WITH THREE ORGANIZATIONS.
 *
 * WHY THREE AND NOT TWO
 *
 * Every other suite in this program uses two tenants, because every other
 * question is "is this mine?" and two is enough to answer it. Federation's
 * question is different: a record belongs to a RELATIONSHIP, so two tenants
 * cannot distinguish the two failure modes that matter.
 *
 *   With A and B only, "A can see the A↔B share" and "everyone can see
 *   everything" produce identical test output.
 *
 * C exists to tell those apart. C is a real, signed-in organization on the same
 * install with the same permissions, related to nobody. Every assertion about C
 * is an assertion that a relationship between two other parties is not a
 * disclosure to a third.
 *
 * THE SHAPE OF THE FINDING THIS REPLACES
 *
 * `FederationRuntimeStore` took its home organization as a CONSTRUCTOR
 * ARGUMENT, wired to the seeded `ORG_ID`. Home was a property of the machine,
 * so every tenant saw the same directory, invitations, trust and shares —
 * and `revokeShare(id)`, `rollback(artifactId)`, `setVerification(...)`,
 * `setScope(...)` and `publishVersion(...)` each acted on a bare payload id.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CloudRegionId, TenantScope } from '@neuropause/shared';
import { FederationRuntimeStore } from '../../federation/runtime/fedStore';
import { ExchangeStore } from '../../federation/exchange/exchangeStore';

/* ── Three organizations, one install ───────────────────────────────────── */

const A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-bravo', workspaceId: 'ws-b' };
/** Related to nobody. Every `C` assertion is the point of this file. */
const C: TenantScope = { tenantId: 'org-charlie', workspaceId: 'ws-c' };

const MARK_A = 'NP-ORG-A-731904';
const MARK_B = 'NP-ORG-B-518273';

let scope: TenantScope | null = A;
let dir: string;
let fed: FederationRuntimeStore;
let exchange: ExchangeStore;
const regions: Record<string, CloudRegionId> = {
  'org-alpha': 'us-east',
  'org-bravo': 'eu-west',
  'org-charlie': 'ap-south',
};

beforeEach(async () => {
  dir = join(tmpdir(), `np-fed4-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const src = (): TenantScope | null => scope;
  fed = new FederationRuntimeStore(join(dir, 'fed.json'), A.tenantId, 'Alpha').bindScope(src);
  exchange = new ExchangeStore(join(dir, 'exchange.json'))
    .bindScope(src)
    .bindTrustResolver((publisherOrg) => {
      const t = fed.trustFor(publisherOrg);
      return t !== null && t.trustLevel !== 'none';
    })
    .bindRegionResolver(() => (scope ? (regions[scope.tenantId] ?? null) : null));
  await fed.load();
  await exchange.load();
  scope = A;
});

afterEach(async () => {
  await Promise.all([fed.flush().catch(() => {}), exchange.flush().catch(() => {})]);
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/** A ↔ B federate. C is never involved. Returns the ids A and B now share. */
function federateAandB(): { invitationId: string } {
  scope = A;
  const invite = fed.inviteOrg({ name: 'Bravo', trustLevel: 'full', message: MARK_A });
  // The store derives the target id from the name; align B's identity with it so
  // the two sides of the relationship are the same organization.
  return { invitationId: invite.id };
}

/* ── Invitations ────────────────────────────────────────────────────────── */

describe('S-10 — invitations name two organizations', () => {
  it('the SENDER sees its invitation as outbound', () => {
    federateAandB();
    scope = A;
    const mine = fed.listInvitations();
    expect(mine).toHaveLength(1);
    expect(mine[0]?.direction).toBe('outbound');
    expect(mine[0]?.message).toBe(MARK_A);
  });

  /**
   * The whole file in one assertion. C is signed in, has federation:read, and is
   * on the same install — and an A→B invitation is not C's business.
   */
  it('C cannot see an A→B invitation at all', () => {
    federateAandB();
    scope = C;
    expect(fed.listInvitations()).toEqual([]);
    expect(JSON.stringify(fed.listInvitations())).not.toContain(MARK_A);
  });

  it('C cannot RESPOND to an A→B invitation by its id', () => {
    const { invitationId } = federateAandB();
    scope = C;
    expect(fed.respondInvitation(invitationId, true)).toBeNull();

    scope = A;
    expect(fed.listInvitations()[0]?.status).toBe('pending');
  });

  it('a foreign invitation id and an invented one are indistinguishable', () => {
    const { invitationId } = federateAandB();
    scope = C;
    expect(fed.respondInvitation(invitationId, true)).toEqual(
      fed.respondInvitation('inv_invented', true),
    );
  });

  it('an unresolved caller sees no invitations and can send none', () => {
    federateAandB();
    scope = null;
    expect(fed.listInvitations()).toEqual([]);
    expect(() => fed.inviteOrg({ name: 'Ghost', trustLevel: 'basic' })).toThrow(/no party/i);
  });
});

/* ── The organization directory ─────────────────────────────────────────── */

describe('S-10 — the directory is derived from relationships', () => {
  /**
   * `listOrgs()` returned every organization row on the install. On a
   * multi-tenant machine that is the customer list: names, slugs and regions of
   * every other customer, before any federation exists between them.
   */
  it('C sees only itself — never A, never B, never the seeded org', () => {
    federateAandB();
    scope = C;
    const orgs = fed.listOrgs();
    expect(orgs.map((o) => o.id)).not.toContain(A.tenantId);
    expect(orgs.map((o) => o.id)).not.toContain(B.tenantId);
  });

  it('a stranger organization reads as absent by direct id', () => {
    federateAandB();
    scope = C;
    expect(fed.org(A.tenantId)).toBeNull();
  });

  /**
   * `role` is stored as `'home' | 'peer'` and a stored value cannot be relative
   * — every organization is home to itself and a peer to everyone else. It is
   * therefore recomputed per caller on read.
   *
   * Note the ACCEPT step: a directory row is created when an invitation is
   * accepted, not when it is sent. A pending invitee is visible as an
   * invitation and not yet as an organization, which is the pre-existing
   * product behaviour and is left alone here.
   */
  it('`role` is relative to the caller — everyone is home to themselves', () => {
    scope = A;
    const invite = fed.inviteOrg({ name: 'Bravo Co', trustLevel: 'full' });
    const peerId = invite.toOrg;
    scope = { tenantId: peerId, workspaceId: 'ws-peer' };
    fed.respondInvitation(invite.id, true);

    scope = A;
    expect(fed.listOrgs().find((o) => o.id === A.tenantId)?.role).toBe('home');
    expect(fed.listOrgs().find((o) => o.id === peerId)?.role).toBe('peer');

    // And from the peer's side, the same two rows swap roles.
    scope = { tenantId: peerId, workspaceId: 'ws-peer' };
    expect(fed.listOrgs().find((o) => o.id === peerId)?.role).toBe('home');
    expect(fed.listOrgs().find((o) => o.id === A.tenantId)?.role).toBe('peer');
  });

  it('an unresolved caller sees no organizations', () => {
    federateAandB();
    scope = null;
    expect(fed.listOrgs()).toEqual([]);
    expect(fed.homeOrg()).toBeNull();
  });
});

/* ── Trust ──────────────────────────────────────────────────────────────── */

describe('S-10 — trust is relationship-scoped', () => {
  /**
   * A invites, and THE RECIPIENT accepts.
   *
   * The first version of this fixture had A accept its own outbound invitation,
   * because the store allowed it. The sweep found that was the bypass — a
   * sender could manufacture a mutual relationship without consent — so this
   * fixture was reaching its precondition through the very hole the file exists
   * to prove closed. Accepting as the recipient is both correct and what the
   * product does.
   */
  function trustAtoB(): string {
    scope = A;
    const invite = fed.inviteOrg({ name: 'Bravo Co', trustLevel: 'full' });
    const peerId = invite.toOrg;
    scope = { tenantId: peerId, workspaceId: 'ws-peer' };
    fed.respondInvitation(invite.id, true);
    return peerId;
  }

  it('A sees the A↔peer trust it established', () => {
    const peerId = trustAtoB();
    scope = A;
    const trust = fed.listTrust();
    expect(trust).toHaveLength(1);
    expect(trust[0]?.peerOrg).toBe(peerId);
  });

  it('C cannot list or reach A’s trust relationships', () => {
    const peerId = trustAtoB();
    scope = C;
    expect(fed.listTrust()).toEqual([]);
    expect(fed.trustFor(peerId)).toBeNull();
  });

  /** Naming another organization's peer must not reach that organization's row. */
  it('C cannot MODIFY A’s trust by naming A’s peer', () => {
    const peerId = trustAtoB();
    scope = C;
    expect(fed.setTrust(peerId, { trustLevel: 'none', canShareData: false })).toBeNull();

    scope = A;
    expect(fed.trustFor(peerId)?.trustLevel).toBe('full');
  });

  it('an unresolved caller sees no trust', () => {
    trustAtoB();
    scope = null;
    expect(fed.listTrust()).toEqual([]);
  });
});

/* ── Shared resources ───────────────────────────────────────────────────── */

describe('S-10 — a share is visible to BOTH parties and to nobody else', () => {
  /** A federates with B and shares one resource outbound. */
  function shareAtoB(): { shareId: string; peerId: string } {
    scope = A;
    const invite = fed.inviteOrg({ name: 'Bravo Co', trustLevel: 'full' });
    const peerId = invite.toOrg;
    scope = { tenantId: peerId, workspaceId: 'ws-peer' };
    fed.respondInvitation(invite.id, true); // the RECIPIENT accepts
    scope = A;
    const share = fed.shareResource({
      kind: 'governance_policy',
      name: `Policy ${MARK_A}`,
      peerOrg: peerId,
      access: 'read',
    });
    return { shareId: (share as { id: string }).id, peerId };
  }

  it('the OWNER sees it, outbound', () => {
    shareAtoB();
    scope = A;
    const mine = fed.listShared();
    expect(mine).toHaveLength(1);
    expect(mine[0]?.direction).toBe('outbound');
  });

  /**
   * THE CASE A NAIVE `tenantId` FILTER WOULD HAVE BROKEN.
   *
   * If sharing were fixed by stamping one owner and filtering on it, the
   * recipient could not see what was shared with them — isolation that looks
   * correct and is a broken product. The participant must see it, inbound.
   */
  it('the PARTICIPANT sees it too, inbound — sharing still works', () => {
    const { peerId } = shareAtoB();
    scope = { tenantId: peerId, workspaceId: 'ws-peer' };
    const theirs = fed.listShared();
    expect(theirs).toHaveLength(1);
    expect(theirs[0]?.direction).toBe('inbound');
    expect(theirs[0]?.name).toContain(MARK_A);
  });

  it('C sees nothing — a relationship is not a broadcast', () => {
    shareAtoB();
    scope = C;
    expect(fed.listShared()).toEqual([]);
    expect(JSON.stringify(fed.listShared())).not.toContain(MARK_A);
  });

  it('C cannot REVOKE an A↔B share by its id', () => {
    const { shareId } = shareAtoB();
    scope = C;
    expect(fed.revokeShare(shareId)).toBe(false);

    scope = A;
    expect(fed.listShared()).toHaveLength(1);
  });

  it('the owner CAN revoke — the gate is not simply "no"', () => {
    const { shareId } = shareAtoB();
    scope = A;
    expect(fed.revokeShare(shareId)).toBe(true);
    expect(fed.listShared()).toEqual([]);
  });

  /** Declining an unwanted inbound share is a legitimate operation. */
  it('the participant may withdraw its own participation', () => {
    const { shareId, peerId } = shareAtoB();
    scope = { tenantId: peerId, workspaceId: 'ws-peer' };
    expect(fed.revokeShare(shareId)).toBe(true);
  });

  it('C cannot share INTO a relationship it is not part of', () => {
    const { peerId } = shareAtoB();
    scope = C;
    const attempt = fed.shareResource({
      kind: 'connector',
      name: 'Hostile',
      peerOrg: peerId,
      access: 'collaborate',
    });
    expect(attempt).toHaveProperty('error');
  });

  it('the summary counts only the caller’s own federation', () => {
    shareAtoB();
    scope = C;
    const s = fed.summary();
    expect(s.sharedOut).toBe(0);
    expect(s.sharedIn).toBe(0);
    expect(s.trustedPeers).toBe(0);
  });
});

/* ── Artifacts: publishing ──────────────────────────────────────────────── */

describe('S-10 — publisher ownership comes from the caller, not a constant', () => {
  it('A publishing yields publisherOrg = A; B publishing yields B', () => {
    scope = A;
    const artA = exchange.publish({
      kind: 'ai_worker',
      name: `Worker ${MARK_A}`,
      summary: MARK_A,
      scope: 'public',
      publisherOrgName: 'Alpha',
    });
    scope = B;
    const artB = exchange.publish({
      kind: 'ai_worker',
      name: `Worker ${MARK_B}`,
      summary: MARK_B,
      scope: 'public',
      publisherOrgName: 'Bravo',
    });

    expect(artA.publisherOrg).toBe(A.tenantId);
    expect(artB.publisherOrg).toBe(B.tenantId);
    // Neither is the seeded organization, which is what the handler used to pass.
    expect([artA.publisherOrg, artB.publisherOrg]).not.toContain('org-default');
  });

  /**
   * The manifest is Ed25519-SIGNED, so a forged publisher was not merely a wrong
   * label — it was a cryptographically attested wrong label.
   */
  it('the signature is computed over the REAL publisher', () => {
    scope = B;
    const art = exchange.publish({
      kind: 'connector_pack',
      name: 'Pack',
      summary: MARK_B,
      scope: 'public',
      publisherOrgName: 'Bravo',
    });
    expect(exchange.verifyVersion(art.id, art.currentVersionId)).toBe(true);

    // And A cannot verify-as-B: the artifact resolves for A only because it is
    // public, and its publisher is still B.
    scope = A;
    expect(exchange.artifact(art.id)?.publisherOrg).toBe(B.tenantId);
  });

  it('an unresolved caller cannot publish', () => {
    scope = null;
    expect(() =>
      exchange.publish({ kind: 'ai_worker', name: 'x', summary: 'x', scope: 'public', publisherOrgName: 'x' }),
    ).toThrow(/no party/i);
  });
});

/* ── Artifacts: visibility by scope ─────────────────────────────────────── */

describe('S-10 — artifact visibility follows the publisher’s scope', () => {
  function publishAs(tenant: TenantScope, artScope: 'private' | 'public' | 'partner' | 'regional', regionId: CloudRegionId | null = null) {
    scope = tenant;
    return exchange.publish({
      kind: 'knowledge_package',
      name: `Pack ${tenant.tenantId}`,
      summary: tenant === A ? MARK_A : MARK_B,
      scope: artScope,
      publisherOrgName: tenant.tenantId,
      regionId,
    });
  }

  it('PRIVATE is the publisher only — and reads as absent, not as refused', () => {
    const art = publishAs(A, 'private');
    scope = A;
    expect(exchange.artifact(art.id)).not.toBeNull();
    scope = C;
    expect(exchange.artifact(art.id)).toBeNull();
    expect(exchange.listArtifacts().map((a) => a.id)).not.toContain(art.id);
  });

  it('PUBLIC is visible to an unrelated organization — the exchange still works', () => {
    const art = publishAs(A, 'public');
    scope = C;
    expect(exchange.artifact(art.id)?.publisherOrg).toBe(A.tenantId);
  });

  it('PARTNER needs a trust relationship, which C does not have', () => {
    scope = A;
    const invite = fed.inviteOrg({ name: 'Bravo Co', trustLevel: 'full' });
    const partnerId = invite.toOrg;
    scope = { tenantId: partnerId, workspaceId: 'ws-p' };
    fed.respondInvitation(invite.id, true); // the RECIPIENT accepts

    const art = publishAs(A, 'partner');

    scope = { tenantId: partnerId, workspaceId: 'ws-p' };
    // The partner's own trust row names A, so A's partner-scoped artifact resolves.
    expect(exchange.artifact(art.id)).not.toBeNull();

    scope = C;
    expect(exchange.artifact(art.id)).toBeNull();
  });

  it('REGIONAL matches the caller’s region in BOTH directions', () => {
    const euArt = publishAs(B, 'regional', 'eu-west');
    scope = B; // eu-west
    expect(exchange.artifact(euArt.id)).not.toBeNull();
    scope = C; // ap-south
    expect(exchange.artifact(euArt.id)).toBeNull();
    scope = A; // us-east
    expect(exchange.artifact(euArt.id)).toBeNull();
  });

  it('an unresolved caller sees nothing, including public artifacts', () => {
    publishAs(A, 'public');
    scope = null;
    expect(exchange.listArtifacts()).toEqual([]);
  });
});

/* ── Artifacts: the write matrix ────────────────────────────────────────── */

describe('S-10 — cross-organization writes on artifacts are denied', () => {
  function publicArtifactByA(): string {
    scope = A;
    return exchange.publish({
      kind: 'workflow_template',
      name: `Flow ${MARK_A}`,
      summary: MARK_A,
      scope: 'public',
      publisherOrgName: 'Alpha',
    }).id;
  }

  it('C cannot publish a VERSION onto A’s artifact — a signed forged release', () => {
    const id = publicArtifactByA();
    scope = C;
    expect(exchange.publishVersion(id, '9.9.9', 'hostile')).toBeNull();
    scope = A;
    expect(exchange.artifact(id)?.versions).toHaveLength(1);
  });

  it('C cannot ROLL BACK A’s artifact — a supply-chain action on A’s installers', () => {
    const id = publicArtifactByA();
    scope = A;
    exchange.publishVersion(id, '2.0.0', 'v2');
    const currentAfterV2 = exchange.artifact(id)?.currentVersionId;

    scope = C;
    expect(exchange.rollback(id)).toBeNull();

    scope = A;
    expect(exchange.artifact(id)?.currentVersionId).toBe(currentAfterV2);
  });

  it('C cannot change A’s VERIFICATION status', () => {
    const id = publicArtifactByA();
    scope = C;
    expect(exchange.setVerification(id, 'official')).toBeNull();
    scope = A;
    expect(exchange.artifact(id)?.verification).toBe('unverified');
  });

  /**
   * The sharpest of the bare-id writes: `setScope` is the setting that DECIDES
   * visibility, so flipping another organization's private draft to public
   * publishes it to the whole federation in one call.
   */
  it('C cannot change A’s SCOPE, and so cannot publish A’s private draft', () => {
    scope = A;
    const draft = exchange.publish({
      kind: 'dashboard_template',
      name: `Draft ${MARK_A}`,
      summary: MARK_A,
      scope: 'private',
      publisherOrgName: 'Alpha',
    });

    scope = C;
    expect(exchange.setScope(draft.id, 'public')).toBeNull();
    expect(exchange.listArtifacts().map((a) => a.id)).not.toContain(draft.id);

    scope = A;
    expect(exchange.artifact(draft.id)?.scope).toBe('private');
  });

  it('the publisher CAN do all four — the gate is not simply "no"', () => {
    const id = publicArtifactByA();
    scope = A;
    expect(exchange.publishVersion(id, '1.1.0', 'ok')).not.toBeNull();
    expect(exchange.setVerification(id, 'verified')?.verification).toBe('verified');
    expect(exchange.setScope(id, 'partner')?.scope).toBe('partner');
    expect(exchange.rollback(id)).not.toBeNull();
  });
});

/* ── Installation ───────────────────────────────────────────────────────── */

describe('S-10 — installation records the installer and never rewrites the publisher', () => {
  function publicArtifactByA(): string {
    scope = A;
    return exchange.publish({
      kind: 'connector_pack',
      name: `Pack ${MARK_A}`,
      summary: MARK_A,
      scope: 'public',
      publisherOrgName: 'Alpha',
    }).id;
  }

  it('B installs A’s artifact: publisher stays A, installer becomes B', () => {
    const id = publicArtifactByA();
    scope = B;
    const installed = exchange.install(id);
    expect(installed?.publisherOrg).toBe(A.tenantId);
    expect(installed?.installations?.map((i) => i.orgId)).toEqual([B.tenantId]);
  });

  /** Who installed what, across customers, is not a public marketplace fact. */
  it('C cannot see that B installed it', () => {
    const id = publicArtifactByA();
    scope = B;
    exchange.install(id);

    scope = C;
    const seen = exchange.artifact(id);
    expect(seen?.installations).toEqual([]);
    expect(JSON.stringify(seen)).not.toContain(B.tenantId);
  });

  it('the publisher does not see WHICH organizations installed, only its own', () => {
    const id = publicArtifactByA();
    scope = B;
    exchange.install(id);
    scope = A;
    expect(exchange.artifact(id)?.installations).toEqual([]);
    // The aggregate count remains, as an ordinary marketplace signal.
    expect(exchange.artifact(id)?.installs).toBe(1);
  });

  it('C cannot install an artifact it cannot see', () => {
    scope = A;
    const draft = exchange.publish({
      kind: 'ai_worker',
      name: 'Secret',
      summary: MARK_A,
      scope: 'private',
      publisherOrgName: 'Alpha',
    });
    scope = C;
    expect(exchange.install(draft.id)).toBeNull();
    scope = A;
    expect(exchange.artifact(draft.id)?.installs).toBe(0);
  });

  it('re-installing does not inflate the public count', () => {
    const id = publicArtifactByA();
    scope = B;
    exchange.install(id);
    exchange.install(id);
    scope = A;
    expect(exchange.artifact(id)?.installs).toBe(1);
  });
});

/* ── Switching and concurrency ──────────────────────────────────────────── */

describe('S-10 — switching organizations re-resolves federation', () => {
  it('A → B → C → A returns each organization’s own view, with no residue', () => {
    scope = A;
    const artA = exchange.publish({
      kind: 'ai_worker', name: `A ${MARK_A}`, summary: MARK_A, scope: 'private', publisherOrgName: 'Alpha',
    });
    scope = B;
    const artB = exchange.publish({
      kind: 'ai_worker', name: `B ${MARK_B}`, summary: MARK_B, scope: 'private', publisherOrgName: 'Bravo',
    });

    scope = A;
    let blob = JSON.stringify(exchange.listArtifacts());
    expect(blob).toContain(MARK_A);
    expect(blob).not.toContain(MARK_B);

    scope = B;
    blob = JSON.stringify(exchange.listArtifacts());
    expect(blob).toContain(MARK_B);
    expect(blob).not.toContain(MARK_A);

    scope = C;
    blob = JSON.stringify(exchange.listArtifacts());
    expect(blob).not.toContain(MARK_A);
    expect(blob).not.toContain(MARK_B);

    scope = A;
    expect(exchange.artifact(artA.id)).not.toBeNull();
    expect(exchange.artifact(artB.id)).toBeNull();
  });

  /**
   * Interleaved, not merely sequential. The stores hold no per-call state, so
   * this is really asserting that no accessor caches a resolved organization
   * between calls — which is exactly the defect H-2 found elsewhere.
   */
  it('interleaved publishes keep their own publisher', () => {
    const ids: { org: string; id: string }[] = [];
    for (const t of [A, B, C, A, B, C]) {
      scope = t;
      const art = exchange.publish({
        kind: 'governance_policy',
        name: `P ${t.tenantId}`,
        summary: 'x',
        scope: 'private',
        publisherOrgName: t.tenantId,
      });
      ids.push({ org: t.tenantId, id: art.id });
    }
    for (const { org, id } of ids) {
      scope = { tenantId: org, workspaceId: 'w' };
      expect(exchange.artifact(id)?.publisherOrg).toBe(org);
    }
  });
});
