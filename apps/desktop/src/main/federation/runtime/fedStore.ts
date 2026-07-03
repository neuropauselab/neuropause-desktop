/**
 * The federation runtime store. The home organization plus federated **peers**,
 * organization invitations (inbound + outbound), trust relationships (with
 * delegated-approval and share capabilities), and shared resources in both
 * directions.
 *
 * Tenant isolation is strict: sharing is explicit and per-resource, trust is
 * per-peer, and nothing is shared by default. Peers are seeded fixtures modeling
 * the federation (an honest seam) — the operations + trust model are real and
 * drop onto a real federation backend unchanged. Electron-free.
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
import { createLogger } from '../../logger';

const log = createLogger('federation-runtime');

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
  private orgs = new Map<string, FederatedOrg>();
  private invitations = new Map<string, OrgInvitation>();
  private trust = new Map<string, TrustRelationship>();
  private shared = new Map<string, SharedResource>();
  private homeOrgId = '';
  private homeOrgName = '';

  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, homeOrgId: string, homeOrgName: string) {
    super();
    this.homeOrgId = homeOrgId;
    this.homeOrgName = homeOrgName;
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
    this.orgs.set(this.homeOrgId, {
      id: this.homeOrgId,
      name: this.homeOrgName,
      slug: this.homeOrgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      role: 'home',
      status: 'active',
      regionId: 'us-east',
      trustLevel: 'full',
      joinedAt: new Date(now - 120 * 86_400_000).toISOString(),
      sharedOut: 0,
      sharedIn: 0,
    });
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
      fromOrg: this.homeOrgId,
      fromOrgName: this.homeOrgName,
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
      toOrg: this.homeOrgId,
      toOrgName: this.homeOrgName,
      direction: 'inbound',
      status: 'pending',
      trustLevel: 'verified',
      message: 'We would like to federate AI workers for joint research.',
      createdAt: new Date(now - 86_400_000).toISOString(),
      respondedAt: null,
    });

    // Seed a few shared resources (outbound to Helios, inbound from Aperture).
    const mkShare = (kind: SharedResourceKind, name: string, peerOrg: string, peerOrgName: string, direction: SharedResource['direction'], access: ShareAccess): void => {
      const id = `share_${randomUUID()}`;
      this.shared.set(id, { id, kind, name, peerOrg, peerOrgName, direction, access, sharedAt: new Date(now - 10 * 86_400_000).toISOString() });
    };
    mkShare('governance_policy', 'Data Handling Baseline', 'org-helios', 'Helios Commerce', 'outbound', 'read');
    mkShare('ai_worker', 'Compliance Reviewer', 'org-helios', 'Helios Commerce', 'outbound', 'collaborate');
    mkShare('project', 'Quarterly Close', 'org-aperture', 'Aperture Capital', 'inbound', 'read');
    mkShare('connector', 'NetSuite Pack', 'org-aperture', 'Aperture Capital', 'inbound', 'read');

    this.schedulePersist();
  }

  private recomputeShareCounts(): void {
    for (const org of this.orgs.values()) {
      if (org.role === 'home') continue;
      const out = [...this.shared.values()].filter((s) => s.peerOrg === org.id && s.direction === 'outbound').length;
      const inb = [...this.shared.values()].filter((s) => s.peerOrg === org.id && s.direction === 'inbound').length;
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

  homeOrg(): FederatedOrg | null {
    return this.orgs.get(this.homeOrgId) ?? null;
  }
  listOrgs(): FederatedOrg[] {
    return [...this.orgs.values()].sort((a, b) => (a.role === 'home' ? -1 : b.role === 'home' ? 1 : a.name.localeCompare(b.name)));
  }
  peers(): FederatedOrg[] {
    return [...this.orgs.values()].filter((o) => o.role === 'peer');
  }
  org(id: string): FederatedOrg | null {
    return this.orgs.get(id) ?? null;
  }
  listInvitations(): OrgInvitation[] {
    return [...this.invitations.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  listTrust(): TrustRelationship[] {
    return [...this.trust.values()].sort((a, b) => a.peerOrgName.localeCompare(b.peerOrgName));
  }
  trustFor(peerOrg: string): TrustRelationship | null {
    return [...this.trust.values()].find((t) => t.peerOrg === peerOrg) ?? null;
  }
  listShared(): SharedResource[] {
    return [...this.shared.values()].sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
  }

  summary(): FederationSummary {
    const orgs = [...this.orgs.values()];
    const peers = orgs.filter((o) => o.role === 'peer');
    const shared = [...this.shared.values()];
    return {
      orgs: orgs.length,
      peers: peers.length,
      activePeers: peers.filter((p) => p.status === 'active').length,
      pendingInvites: [...this.invitations.values()].filter((i) => i.status === 'pending').length,
      trustedPeers: [...this.trust.values()].filter((t) => t.trustLevel === 'verified' || t.trustLevel === 'full').length,
      sharedOut: shared.filter((s) => s.direction === 'outbound').length,
      sharedIn: shared.filter((s) => s.direction === 'inbound').length,
    };
  }

  inviteOrg(input: { name: string; trustLevel: TrustLevel; message?: string }): OrgInvitation {
    const id = `inv_${randomUUID()}`;
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const targetId = `org-${slug}`;
    const invite: OrgInvitation = {
      id,
      fromOrg: this.homeOrgId,
      fromOrgName: this.homeOrgName,
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

  respondInvitation(id: string, accept: boolean): OrgInvitation | null {
    const inv = this.invitations.get(id);
    if (!inv || inv.status !== 'pending') return inv ?? null;
    const next: OrgInvitation = { ...inv, status: accept ? 'accepted' : 'declined', respondedAt: new Date().toISOString() };
    this.invitations.set(id, next);

    if (accept) {
      // The peer is the "other" org on the invitation.
      const peerId = inv.direction === 'inbound' ? inv.fromOrg : inv.toOrg;
      const peerName = inv.direction === 'inbound' ? inv.fromOrgName : inv.toOrgName;
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
      if (!this.trustFor(peerId)) {
        const tid = `trust_${randomUUID()}`;
        this.trust.set(tid, {
          id: tid,
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

  setTrust(peerOrg: string, patch: { trustLevel?: TrustLevel; delegatedApproval?: boolean; canShareWorkers?: boolean; canShareData?: boolean }): TrustRelationship | null {
    const existing = this.trustFor(peerOrg);
    if (!existing) return null;
    const next: TrustRelationship = { ...existing, ...patch };
    this.trust.set(existing.id, next);
    const org = this.orgs.get(peerOrg);
    if (org && patch.trustLevel) this.orgs.set(peerOrg, { ...org, trustLevel: patch.trustLevel });
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  shareResource(input: { kind: SharedResourceKind; name: string; peerOrg: string; access: ShareAccess }): SharedResource | { error: string } {
    const peer = this.orgs.get(input.peerOrg);
    if (!peer || peer.role !== 'peer' || peer.status !== 'active') return { error: 'Peer is not an active federated organization.' };
    const trust = this.trustFor(input.peerOrg);
    if ((input.kind === 'ai_worker') && !trust?.canShareWorkers) return { error: 'Trust level does not permit sharing AI workers with this peer.' };
    if ((input.kind === 'connector' || input.kind === 'project' || input.kind === 'workspace') && input.access === 'collaborate' && !trust?.canShareData) {
      return { error: 'Trust level does not permit collaborative data sharing with this peer.' };
    }
    const id = `share_${randomUUID()}`;
    const resource: SharedResource = { id, kind: input.kind, name: input.name, peerOrg: input.peerOrg, peerOrgName: peer.name, direction: 'outbound', access: input.access, sharedAt: new Date().toISOString() };
    this.shared.set(id, resource);
    this.recomputeShareCounts();
    this.schedulePersist();
    this.emit('changed');
    return resource;
  }

  revokeShare(id: string): boolean {
    const ok = this.shared.delete(id);
    if (ok) {
      this.recomputeShareCounts();
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }
}
