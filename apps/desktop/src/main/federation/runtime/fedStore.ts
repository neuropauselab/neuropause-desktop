/**
 * The federation runtime store. The home organization plus federated **peers**,
 * organization invitations (inbound + outbound), trust relationships (with
 * delegated-approval and share capabilities), and shared resources in both
 * directions.
 *
 * Peers are seeded fixtures modeling the federation (an honest seam) — the
 * operations + trust model are real and drop onto a real federation backend
 * unchanged. Electron-free.
 *
 * P13C ROUND 4 — S-10. "HOME" IS THE CALLER, NOT THE INSTALL.
 *
 * The doc comment above used to claim "tenant isolation is strict". It was not
 * merely imperfect — the subsystem had NO TENANT DIMENSION. `homeOrgId` arrived
 * as a CONSTRUCTOR ARGUMENT wired to the seeded `ORG_ID`, so the home
 * organization was a property of the machine. Every tenant on the install saw
 * the same home org, the same peer directory, the same invitations, the same
 * trust records and the same shares; `revokeShare(id)` deleted whatever id it
 * was handed.
 *
 * That claim of strictness is worth leaving in the history rather than quietly
 * deleting: it is the reason five sweeps of this program never opened this file.
 * A confident comment is read as evidence.
 *
 * WHAT REPLACED IT
 *
 * Every record now names TWO organizations and the caller must be one of them
 * (`FederationBoundary`). Invitations already carried `fromOrg`/`toOrg`; trust
 * and shares gained `ownerOrg` beside their existing `peerOrg`. The org
 * directory is derived from those relationships rather than listed, so a tenant
 * learns another organization exists only once a record names them both.
 *
 * `homeOrgId` survives for exactly one purpose — seeding the first install's own
 * organization row — and authorizes nothing. See `applySeed`.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  CloudRegionId,
  FederatedOrg,
  FederationSummary,
  OrgInvitation,
  ShareAccess,
  SharedResource,
  SharedResourceKind,
  TrustLevel,
  TrustRelationship,
} from '@neuropause/shared';
import type { TenantScope } from '@neuropause/shared';
import { FederationBoundary, type FederationParties } from '../tenancy/federationBoundary';
import { createLogger } from '../../logger';
import { demoSeedsEnabled } from '../../demoSeed';
import { declareStoreScope } from '../../tenancy/storeScope';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'federation-runtime',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention: 'No cap. revokeShare deletes one row after a party check.',
  reason: 'Every row names two organizations and seedOrgId authorizes nothing: home is the caller, not the install. A peer directory is a relationship, so the boundary is a relationship rather than a single owner.',
});

const log = createLogger('federation-runtime');

/**
 * The two organizations each record names.
 *
 * Written once, here, and used by every read and every write below — so the
 * question "who are the parties to this row?" has exactly one answer per record
 * type. A per-accessor answer is how two of them would eventually disagree.
 */
function trustParties(t: TrustRelationship): FederationParties {
  return { owner: t.ownerOrg ?? null, peer: t.peerOrg };
}
function shareParties(s: SharedResource): FederationParties {
  return { owner: s.ownerOrg ?? null, peer: s.peerOrg };
}
/**
 * An invitation's parties, with `owner` meaning THE SENDER.
 *
 * `direction` is the one field here that is relative to the viewer rather than
 * intrinsic — the same row is "outbound" to its sender and "inbound" to its
 * recipient. It is stored, and stored values cannot be relative, so every read
 * below re-derives it for the caller. Trusting the stored value is how the
 * recipient would see its own invitation labelled "outbound".
 */
function invitationParties(i: OrgInvitation): FederationParties {
  return { owner: i.fromOrg, peer: i.toOrg };
}

interface FedFile {
  orgs: FederatedOrg[];
  invitations: OrgInvitation[];
  trust: TrustRelationship[];
  shared: SharedResource[];
  seeded: boolean;
}

interface SeedPeer {
  id: string;
  name: string;
  slug: string;
  regionId: CloudRegionId;
  status: FederatedOrg['status'];
  trustLevel: TrustLevel;
}

const SEED_PEERS: SeedPeer[] = [
  { id: 'org-helios', name: 'Helios Commerce', slug: 'helios', regionId: 'eu-west', status: 'active', trustLevel: 'verified' },
  { id: 'org-aperture', name: 'Aperture Capital', slug: 'aperture', regionId: 'us-west', status: 'active', trustLevel: 'full' },
  { id: 'org-northwind', name: 'Northwind Labs', slug: 'northwind', regionId: 'ap-south', status: 'invited', trustLevel: 'basic' },
];

export class FederationRuntimeStore extends EventEmitter {
  /** The relationship boundary. Registered with the startup gate by construction. */
  private readonly fed = new FederationBoundary('federation-runtime');
  private orgs = new Map<string, FederatedOrg>();
  private invitations = new Map<string, OrgInvitation>();
  private trust = new Map<string, TrustRelationship>();
  private shared = new Map<string, SharedResource>();
  /**
   * The organization this INSTALL was seeded for. Bootstrap only.
   *
   * It names the row `applySeed` creates on a fresh install and is never
   * consulted again. It is deliberately not called "home": home is whoever is
   * asking, and conflating the two is the entire finding.
   */
  private readonly seedOrgId: string;
  private readonly seedOrgName: string;

  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, seedOrgId: string, seedOrgName: string) {
    super();
    this.seedOrgId = seedOrgId;
    this.seedOrgName = seedOrgName;
  }

  /** Bind the relationship boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.fed.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.fed.hasScope();
  }
  /** Unscoped ownership counts over trust + shares, for the migration inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.fed.countOwnership([
      ...[...this.trust.values()].map(trustParties),
      ...[...this.shared.values()].map(shareParties),
    ]);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<FedFile>;
      for (const o of data.orgs ?? []) if (o?.id) this.orgs.set(o.id, o);
      for (const i of data.invitations ?? []) if (i?.id) this.invitations.set(i.id, i);
      for (const t of data.trust ?? []) if (t?.id) this.trust.set(t.id, t);
      for (const s of data.shared ?? []) if (s?.id) this.shared.set(s.id, s);
      if (!data.seeded || this.orgs.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.recomputeShareCounts();
    this.loaded = true;
    log.info('Federation runtime ready', { orgs: this.orgs.size, peers: this.orgs.size - 1, trust: this.trust.size, shared: this.shared.size });
  }

  private applySeed(): void {
    const now = Date.now();
    this.orgs.set(this.seedOrgId, {
      id: this.seedOrgId,
      name: this.seedOrgName,
      slug: this.seedOrgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      role: 'home',
      status: 'active',
      regionId: 'us-east',
      trustLevel: 'full',
      joinedAt: new Date(now - 120 * 86_400_000).toISOString(),
      sharedOut: 0,
      sharedIn: 0,
    });
    // The home organization above is real (the local org) and always seeds. Everything below — peer
    // organizations, their trust records, pending invitations, and shared resources — is fabricated federation
    // activity that must not appear in a production install (which starts with zero peers). Gate it behind the
    // demo-seed flag.
    if (!demoSeedsEnabled()) {
      this.schedulePersist();
      return;
    }
    for (const p of SEED_PEERS) {
      this.orgs.set(p.id, {
        id: p.id,
        name: p.name,
        slug: p.slug,
        role: 'peer',
        status: p.status,
        regionId: p.regionId,
        trustLevel: p.status === 'active' ? p.trustLevel : 'none',
        joinedAt: new Date(now - Math.floor(Math.random() * 90 + 10) * 86_400_000).toISOString(),
        sharedOut: 0,
        sharedIn: 0,
      });
      if (p.status === 'active') {
        const tid = `trust_${randomUUID()}`;
        this.trust.set(tid, {
          id: tid,
          // The DEMO seed models the seeded organization's own federation, so it
          // is stamped with the seed org. It is demo data behind a flag; it is
          // not, and must not become, an authorization default.
          ownerOrg: this.seedOrgId,
          peerOrg: p.id,
          peerOrgName: p.name,
          trustLevel: p.trustLevel,
          delegatedApproval: p.trustLevel === 'full',
          canShareWorkers: p.trustLevel === 'verified' || p.trustLevel === 'full',
          canShareData: p.trustLevel === 'full',
          establishedAt: new Date(now - 30 * 86_400_000).toISOString(),
        });
      }
    }

    // A pending outbound invitation (we invited Northwind) + an inbound one.
    const outId = `inv_${randomUUID()}`;
    this.invitations.set(outId, {
      id: outId,
      fromOrg: this.seedOrgId,
      fromOrgName: this.seedOrgName,
      toOrg: 'org-northwind',
      toOrgName: 'Northwind Labs',
      direction: 'outbound',
      status: 'pending',
      trustLevel: 'basic',
      message: 'Join our federation to share connector packs.',
      createdAt: new Date(now - 3 * 86_400_000).toISOString(),
      respondedAt: null,
    });
    const inId = `inv_${randomUUID()}`;
    this.invitations.set(inId, {
      id: inId,
      fromOrg: 'org-quanta',
      fromOrgName: 'Quanta Group',
      toOrg: this.seedOrgId,
      toOrgName: this.seedOrgName,
      direction: 'inbound',
      status: 'pending',
      trustLevel: 'verified',
      message: 'We would like to federate AI workers for joint research.',
      createdAt: new Date(now - 86_400_000).toISOString(),
      respondedAt: null,
    });

    // Seed a few shared resources (outbound to Helios, inbound from Aperture).
    /**
     * Seeded shares name BOTH sides.
     *
     * An "inbound" demo share is one the PEER owns and the seeded org
     * participates in, so its `ownerOrg` is the peer — not the seed. Getting
     * that backwards would make the seeded org appear to own resources it only
     * receives, and `revokeShare` would then let it delete a peer's record.
     */
    const mkShare = (kind: SharedResourceKind, name: string, peerOrg: string, peerOrgName: string, direction: SharedResource['direction'], access: ShareAccess): void => {
      const id = `share_${randomUUID()}`;
      const ownerOrg = direction === 'outbound' ? this.seedOrgId : peerOrg;
      const otherOrg = direction === 'outbound' ? peerOrg : this.seedOrgId;
      this.shared.set(id, { id, kind, name, ownerOrg, peerOrg: otherOrg, peerOrgName, direction, access, sharedAt: new Date(now - 10 * 86_400_000).toISOString() });
    };
    mkShare('governance_policy', 'Data Handling Baseline', 'org-helios', 'Helios Commerce', 'outbound', 'read');
    mkShare('ai_worker', 'Compliance Reviewer', 'org-helios', 'Helios Commerce', 'outbound', 'collaborate');
    mkShare('project', 'Quarterly Close', 'org-aperture', 'Aperture Capital', 'inbound', 'read');
    mkShare('connector', 'NetSuite Pack', 'org-aperture', 'Aperture Capital', 'inbound', 'read');

    this.schedulePersist();
  }

  /**
   * Per-organization share counts, computed from BOTH sides of each record.
   *
   * Previously keyed on `peerOrg` + the stored `direction`, which only made
   * sense when there was one home organization: a record's `direction` is
   * relative to a viewer, so counting with it produced numbers that were right
   * for the seeded org and meaningless for anybody else.
   *
   * These counts live on the shared directory row, so they are visible to every
   * organization that may see that row. They are counts of that organization's
   * OWN sharing activity — which is a fact about a party you already federate
   * with — and deliberately not a breakdown of who it shares with.
   */
  private recomputeShareCounts(): void {
    const shares = [...this.shared.values()];
    for (const org of this.orgs.values()) {
      const out = shares.filter((s) => s.ownerOrg === org.id).length;
      const inb = shares.filter((s) => s.peerOrg === org.id).length;
      this.orgs.set(org.id, { ...org, sharedOut: out, sharedIn: inb });
    }
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const payload: FedFile = {
      orgs: [...this.orgs.values()],
      invitations: [...this.invitations.values()],
      trust: [...this.trust.values()],
      shared: [...this.shared.values()],
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
      log.error('Federation persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /* ── Reads. Every one of these returned the whole install. ──────────────── */

  /** The CALLER'S own organization row, created on first sight. */
  homeOrg(): FederatedOrg | null {
    const me = this.fed.callerOrg();
    if (me === null) return null;
    const existing = this.orgs.get(me);
    if (existing) return { ...existing, role: 'home' };
    return null;
  }

  /**
   * The organizations the caller is ALLOWED TO KNOW EXIST.
   *
   * Derived from the caller's own relationships — invitations, trust, shares —
   * rather than read off the directory. On a multi-tenant install the directory
   * is every customer on the machine, so returning it told one customer the
   * names, slugs and regions of every other before any federation existed
   * between them.
   *
   * `role` is computed relative to the CALLER. It is stored as `'home' | 'peer'`
   * and a stored value cannot be relative: every organization is home to itself
   * and a peer to everyone else.
   */
  listOrgs(): FederatedOrg[] {
    const me = this.fed.callerOrg();
    if (me === null) return [];
    const visible = this.fed.relatedOrgs([
      ...[...this.invitations.values()].map(invitationParties),
      ...[...this.trust.values()].map(trustParties),
      ...[...this.shared.values()].map(shareParties),
    ]);
    return [...this.orgs.values()]
      .filter((o) => visible.has(o.id))
      .map((o) => ({ ...o, role: o.id === me ? ('home' as const) : ('peer' as const) }))
      .sort((a, b) => (a.role === 'home' ? -1 : b.role === 'home' ? 1 : a.name.localeCompare(b.name)));
  }

  peers(): FederatedOrg[] {
    return this.listOrgs().filter((o) => o.role === 'peer');
  }

  /** One organization, IF the caller may know it exists. A stranger reads null. */
  org(id: string): FederatedOrg | null {
    return this.listOrgs().find((o) => o.id === id) ?? null;
  }

  /**
   * The invitations the caller SENT OR RECEIVED, with `direction` re-derived.
   *
   * C cannot see an A→B invitation at all, which is the point: an invitation
   * names two organizations and discloses that they are talking.
   */
  listInvitations(): OrgInvitation[] {
    const me = this.fed.callerOrg();
    if (me === null) return [];
    return this.fed
      .onlyMine([...this.invitations.values()], invitationParties)
      .map((i) => ({ ...i, direction: i.fromOrg === me ? ('outbound' as const) : ('inbound' as const) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** One invitation the caller is a party to, or null. For the write paths. */
  private myInvitation(id: string): OrgInvitation | null {
    const inv = this.invitations.get(id) ?? null;
    return inv !== null && this.fed.isParty(invitationParties(inv)) ? inv : null;
  }

  /**
   * The trust relationships the caller is a party to.
   *
   * Trust is inherently cross-tenant and this is NOT solved by letting everyone
   * list everything. A↔B trust is visible to A and to B; C is denied, including
   * on a direct id.
   */
  listTrust(): TrustRelationship[] {
    const me = this.fed.callerOrg();
    if (me === null) return [];
    return this.fed
      .onlyMine([...this.trust.values()], trustParties)
      /**
       * `peerOrg` IS RELATIVE TO THE VIEWER, like `direction` on an invitation.
       *
       * The stored row is `ownerOrg → peerOrg`, so read from the OWNER's side
       * `peerOrg` is the other organization and read from the peer's side it is
       * the reader itself — "my trust relationship with me". Re-derived here for
       * the same reason `direction` is: one stored value cannot be correct for
       * both parties, and a relationship record has two.
       */
      .map((t) =>
        t.peerOrg === me && t.ownerOrg
          ? { ...t, peerOrg: t.ownerOrg, ownerOrg: me }
          : t,
      )
      .sort((a, b) => a.peerOrgName.localeCompare(b.peerOrgName));
  }

  /** The caller's trust WITH a given peer. Was any trust record naming that peer. */
  trustFor(peerOrg: string): TrustRelationship | null {
    const me = this.fed.callerOrg();
    if (me === null) return null;
    return (
      [...this.trust.values()].find(
        (t) =>
          (t.ownerOrg === me && t.peerOrg === peerOrg) ||
          (t.peerOrg === me && t.ownerOrg === peerOrg),
      ) ?? null
    );
  }

  /**
   * Shared resources the caller OWNS or PARTICIPATES IN.
   *
   * A shares with B: visible to A, visible to B, invisible to C. That is the
   * whole requirement, and it is why a plain `tenantId` filter would have been
   * the wrong fix — it would have hidden the share from B, the party the share
   * exists for.
   *
   * `direction` is re-derived for the same reason as an invitation's: the owner
   * shared it out, the peer received it in, and one stored string cannot be both.
   */
  listShared(): SharedResource[] {
    const me = this.fed.callerOrg();
    if (me === null) return [];
    return this.fed
      .onlyMine([...this.shared.values()], shareParties)
      .map((s) => ({ ...s, direction: s.ownerOrg === me ? ('outbound' as const) : ('inbound' as const) }))
      .sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
  }

  /** Counts over the CALLER'S federation. Was an install-wide census. */
  summary(): FederationSummary {
    const orgs = this.listOrgs();
    const peers = orgs.filter((o) => o.role === 'peer');
    const shared = this.listShared();
    return {
      orgs: orgs.length,
      peers: peers.length,
      activePeers: peers.filter((p) => p.status === 'active').length,
      pendingInvites: this.listInvitations().filter((i) => i.status === 'pending').length,
      trustedPeers: this.listTrust().filter((t) => t.trustLevel === 'verified' || t.trustLevel === 'full').length,
      sharedOut: shared.filter((s) => s.direction === 'outbound').length,
      sharedIn: shared.filter((s) => s.direction === 'inbound').length,
    };
  }

  /** Invite another organization. The sender is the CALLER, never the seed. */
  inviteOrg(input: { name: string; trustLevel: TrustLevel; message?: string }): OrgInvitation {
    const me = this.fed.requireCallerOrg();
    const id = `inv_${randomUUID()}`;
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const targetId = `org-${slug}`;
    const invite: OrgInvitation = {
      id,
      fromOrg: me,
      fromOrgName: this.orgs.get(me)?.name ?? me,
      toOrg: targetId,
      toOrgName: input.name,
      direction: 'outbound',
      status: 'pending',
      trustLevel: input.trustLevel,
      message: input.message ?? '',
      createdAt: new Date().toISOString(),
      respondedAt: null,
    };
    this.invitations.set(id, invite);
    this.schedulePersist();
    this.emit('changed');
    return invite;
  }

  /**
   * Respond to an invitation the caller is a party to.
   *
   * Was `invitations.get(id)` on a bare payload id, so any tenant could accept
   * or decline any two organizations' invitation — establishing a trust
   * relationship between two parties neither of whom asked for it.
   *
   * A foreign id and an invented id are the same answer, `null`, so the refusal
   * is not an oracle over other organizations' invitation ids.
   */
  respondInvitation(id: string, accept: boolean): OrgInvitation | null {
    const me = this.fed.callerOrg();
    const inv = this.myInvitation(id);
    if (me === null || inv === null) return null;
    if (inv.status !== 'pending') return inv;
    /**
     * ONLY THE RECIPIENT MAY ACCEPT. The sender may only withdraw.
     *
     * Found by the sweep run at the end of the session that wrote the rest of
     * this file, and it is the more interesting half of the finding: party
     * membership was necessary and NOT SUFFICIENT. `myInvitation` returns the
     * row to either side, so the SENDER could accept its own invitation —
     * manufacturing a mutual federation relationship out of a one-sided
     * request, with no consent from the other organization at all.
     *
     * What that bought, because `inviteOrg` derives the target id from a
     * caller-supplied display name: C invites "Default", accepts on the
     * target's behalf, and now holds a full-trust relationship with
     * `org-default` — which overwrites that organization's directory row with
     * attacker-chosen values and makes every `partner`-scoped artifact it ever
     * published visible to C.
     *
     * Worth stating plainly: the certification suite for this very fix was
     * BUILT on the bypass — its fixtures called `respondInvitation` as the
     * sender to set up trust. A test that uses a hole to reach its
     * precondition cannot detect that hole. Those fixtures now accept as the
     * recipient, which is also what the product does.
     */
    if (accept && inv.toOrg !== me) return null;
    const next: OrgInvitation = { ...inv, status: accept ? 'accepted' : 'declined', respondedAt: new Date().toISOString() };
    this.invitations.set(id, next);

    if (accept) {
      // The peer is the OTHER organization, resolved from the caller rather than
      // from the stored `direction` — which is relative to whoever is reading.
      const peerId = inv.fromOrg === me ? inv.toOrg : inv.fromOrg;
      const peerName = inv.fromOrg === me ? inv.toOrgName : inv.fromOrgName;
      const existing = this.orgs.get(peerId);
      this.orgs.set(peerId, {
        id: peerId,
        name: peerName,
        slug: peerName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        role: 'peer',
        status: 'active',
        regionId: existing?.regionId ?? 'us-east',
        trustLevel: inv.trustLevel,
        joinedAt: new Date().toISOString(),
        sharedOut: 0,
        sharedIn: 0,
      });
      /**
       * THE ACCEPTOR ALSO NEEDS A DIRECTORY ROW.
       *
       * Accepting registers the SENDER as the acceptor's peer, which is the
       * obvious half. The half that is easy to miss is that the sender's
       * directory has no row for the acceptor either — so a federation existed
       * in the relationship records while `listOrgs()` showed neither side the
       * other, because that read filters the directory by relationship AND the
       * directory had nothing to show.
       *
       * Only surfaced once `respondInvitation` became recipient-only. While the
       * sender could accept its own invitation, the sender happened to create
       * the row it needed, and the gap was invisible.
       */
      if (!this.orgs.has(me)) {
        this.orgs.set(me, {
          id: me,
          name: inv.toOrg === me ? inv.toOrgName : inv.fromOrgName,
          slug: me.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          role: 'peer',
          status: 'active',
          regionId: 'us-east',
          trustLevel: inv.trustLevel,
          joinedAt: new Date().toISOString(),
          sharedOut: 0,
          sharedIn: 0,
        });
      }
      if (!this.trustFor(peerId)) {
        const tid = `trust_${randomUUID()}`;
        this.trust.set(tid, {
          id: tid,
          ownerOrg: me,
          peerOrg: peerId,
          peerOrgName: peerName,
          trustLevel: inv.trustLevel,
          delegatedApproval: false,
          canShareWorkers: inv.trustLevel === 'verified' || inv.trustLevel === 'full',
          canShareData: inv.trustLevel === 'full',
          establishedAt: new Date().toISOString(),
        });
      }
    }
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /**
   * Withdraw an invitation the caller SENT. The sender's half of responding.
   *
   * Separated from `respondInvitation` rather than folded into it, because the
   * two are different authorizations over the same row and collapsing them is
   * exactly how the self-accept hole existed.
   */
  revokeInvitation(id: string): OrgInvitation | null {
    const me = this.fed.callerOrg();
    const inv = this.myInvitation(id);
    if (me === null || inv === null || inv.fromOrg !== me) return null;
    if (inv.status !== 'pending') return inv;
    const next: OrgInvitation = { ...inv, status: 'revoked', respondedAt: new Date().toISOString() };
    this.invitations.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /**
   * Change the trust the CALLER extends to a peer.
   *
   * `trustFor` now resolves within the caller's own relationships, so A cannot
   * reach the B↔C record by naming C. Trust is also asymmetric in this model —
   * A's trust of B is A's row — so raising it grants nothing on B's side.
   *
   * The peer's directory row is only re-stamped when the caller OWNS the
   * relationship. Without that check, a peer could rewrite `trustLevel` on the
   * shared directory entry of an organization it merely trusts.
   */
  setTrust(peerOrg: string, patch: { trustLevel?: TrustLevel; delegatedApproval?: boolean; canShareWorkers?: boolean; canShareData?: boolean }): TrustRelationship | null {
    const me = this.fed.callerOrg();
    const existing = this.trustFor(peerOrg);
    if (me === null || !existing) return null;
    if (existing.ownerOrg !== me) return null; // the peer side may read, not rewrite
    const next: TrustRelationship = { ...existing, ...patch };
    this.trust.set(existing.id, next);
    const org = this.orgs.get(peerOrg);
    if (org && patch.trustLevel) this.orgs.set(peerOrg, { ...org, trustLevel: patch.trustLevel });
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  /**
   * Share one of the caller's resources with a peer.
   *
   * `org(peerOrg)` is now the SCOPED accessor, so a caller cannot share with an
   * organization it has no relationship to — which previously let any tenant
   * name any other organization on the install as a share target and create a
   * record binding the two.
   */
  shareResource(input: { kind: SharedResourceKind; name: string; peerOrg: string; access: ShareAccess }): SharedResource | { error: string } {
    const me = this.fed.requireCallerOrg();
    const peer = this.org(input.peerOrg);
    if (!peer || peer.role !== 'peer' || peer.status !== 'active') return { error: 'Peer is not an active federated organization.' };
    const trust = this.trustFor(input.peerOrg);
    if ((input.kind === 'ai_worker') && !trust?.canShareWorkers) return { error: 'Trust level does not permit sharing AI workers with this peer.' };
    if ((input.kind === 'connector' || input.kind === 'project' || input.kind === 'workspace') && input.access === 'collaborate' && !trust?.canShareData) {
      return { error: 'Trust level does not permit collaborative data sharing with this peer.' };
    }
    const id = `share_${randomUUID()}`;
    const resource: SharedResource = { id, kind: input.kind, name: input.name, ownerOrg: me, peerOrg: input.peerOrg, peerOrgName: peer.name, direction: 'outbound', access: input.access, sharedAt: new Date().toISOString() };
    this.shared.set(id, resource);
    this.recomputeShareCounts();
    this.schedulePersist();
    this.emit('changed');
    return resource;
  }

  /**
   * Revoke a share. THE TWO SIDES CAN DO DIFFERENT THINGS.
   *
   * Was `shared.delete(id)` on a bare payload id — any tenant could destroy any
   * two organizations' sharing arrangement, including one it was not party to.
   *
   * The owner may revoke outright: it is their resource. The PEER may also act
   * — declining what was shared with you is a legitimate operation and refusing
   * it would mean an organization cannot get rid of an unwanted inbound share —
   * and the effect is the same record removal, because a share with a withdrawn
   * participant has no remaining meaning. What matters is that a NON-PARTY can
   * do neither, and that is what the `roleIn` check enforces.
   */
  revokeShare(id: string): boolean {
    const share = this.shared.get(id) ?? null;
    if (share === null) return false;
    const role = this.fed.roleIn(shareParties(share));
    if (role === 'none') return false;
    this.shared.delete(id);
    this.recomputeShareCounts();
    this.schedulePersist();
    this.emit('changed');
    return true;
  }
}
