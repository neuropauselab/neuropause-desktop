/**
 * External identities, and the questions about them waiting for a person.
 *
 * WHY THIS IS NOT THE RELATIONSHIP QUEUE
 *
 * Program 6 already has a review queue for ambiguous RELATIONSHIPS, with a
 * store, IPC and a panel — and reusing it was the first thing considered. It is
 * bound at three points to the record model: the item's key must resolve in the
 * declared `RELATIONSHIPS` table, its target must be an `EnterpriseRecordStore`
 * module, and that target must be a live record. An ambiguous IDENTITY is not a
 * declared relationship between two records; it is a question about whether a
 * PROVIDER'S object and a NeuroPause record are the same thing. Forcing it
 * through would mean inventing a fake relationship declaration, which is the
 * kind of reuse that looks tidy and lies.
 *
 * What IS reused: the same persistence substrate (`storeEnvelope`, atomic
 * tmp+rename, 0600, capped), the same IPC conventions, the same audit sink, and
 * the same screen — the queue renders in the Data Command Center beside the
 * relationship queue, because "things needing a person's decision about what
 * matches what" is one idea and deserves one place.
 *
 * WORKSPACE IS PART OF EVERY KEY. An identity question raised in one workspace
 * is not answerable from another, for the same reason its credential is not
 * readable from another.
 */
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  ExternalIdentity,
  IdentityCandidate,
  IdentityEvidence,
  IdentityMatch,
  IdentityState,
  IdentitySubject,
  ServiceIdentity,
} from '@neuropause/shared';
import { scoreEvidence } from '@neuropause/shared';
import { envelopeStamp, readStoreFile } from '../storage/storeEnvelope';
import { createLogger } from '../logger';
import { declareStoreScope } from '../tenancy/storeScope';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'external-identity-store',
  scope: 'WORKSPACE',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention: 'Per-workspace eviction: the victim set is filtered to the writing workspace, and the drop is logged.',
  reason: 'workspaceId is the FIRST element of the four-field providerKey, so a key from one workspace cannot resolve in another. Rows hold provider display names, emails and candidate record matches.',
});

const log = createLogger('identity');

/** Bounded, as every store in this app is. Oldest questions fall off first. */
const MAX_MATCHES = 20_000;
const MAX_IDENTITIES = 200_000;

interface IdentityFile {
  schemaVersion?: number;
  identities: ExternalIdentity[];
  matches: IdentityMatch[];
  services: ServiceIdentity[];
}

/** The identity of a provider object: four fields, never fewer. See the type. */
function providerKey(
  workspaceId: string,
  provider: string,
  connectionId: string,
  entityType: string,
  entityId: string,
): string {
  // JSON-encoded rather than joined with a separator: a provider id containing
  // the separator would otherwise collapse two different objects onto one key.
  return JSON.stringify([workspaceId, provider, connectionId, entityType, entityId]);
}

export class IdentityStore {
  private identities: ExternalIdentity[] = [];
  private matches: IdentityMatch[] = [];
  private services: ServiceIdentity[] = [];
  private byProvider = new Map<string, ExternalIdentity>();
  private matchByProvider = new Map<string, IdentityMatch>();
  private loaded = false;
  /** The in-flight read, so concurrent callers share one. */
  private loading: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private tmpSeq = 0;

  constructor(
    private readonly filePath: string,
    private readonly now: () => string,
  ) {}

  /**
   * Load once, even under concurrent callers.
   *
   * THE BUG THIS FIXES. `if (this.loaded) return` set the flag only AFTER the
   * await, so two callers — the renderer opening the Identity tab while the sync
   * bridge raises a question, both of which start with `await store.load()` —
   * both read the file. The second assignment replaced `this.matches` with the
   * pre-mutation contents and dropped the question that landed in between. The
   * indexes were never cleared before being rebuilt, so the stale entry survived
   * pointing at an orphan: `raiseMatch` then found it, mutated it, incremented
   * its `seenCount` and persisted — and the question never appeared in the queue
   * while its counter climbed invisibly.
   */
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    this.loading ??= this.readFromDisk();
    return this.loading;
  }

  /** Whether the file has been read. `false` means "do not trust an absence". */
  isLoaded(): boolean {
    return this.loaded;
  }

  private async readFromDisk(): Promise<void> {
    const res = await readStoreFile<Partial<IdentityFile>>(this.filePath);
    if (res.state === 'loaded' && res.data) {
      this.identities = Array.isArray(res.data.identities) ? res.data.identities : [];
      this.matches = Array.isArray(res.data.matches) ? res.data.matches : [];
      this.services = Array.isArray(res.data.services) ? res.data.services : [];
      // Cleared, not merged. See the note above.
      this.byProvider.clear();
      this.matchByProvider.clear();
      for (const i of this.identities) {
        this.byProvider.set(
          providerKey(i.workspaceId, i.provider, i.connectionId, i.providerEntityType, i.providerEntityId),
          i,
        );
      }
      for (const m of this.matches) {
        this.matchByProvider.set(
          providerKey(m.workspaceId, m.provider, m.connectionId, m.providerEntityType, m.providerEntityId),
          m,
        );
      }
    } else if (res.state !== 'loaded') {
      /**
       * A corrupt or future-versioned file empties the question queue.
       *
       * Silently, before this: the screen said "no open questions" and meant
       * "I could not read the file". Those are opposite statements and the
       * operator has to be able to tell them apart.
       */
      log.error('Identity state could not be read; the question queue will look empty', {
        state: res.state,
        path: this.filePath,
      });
    }
    this.loaded = true;
  }

  /* ── External identities ───────────────────────────────────────────────── */

  /** Every identity in a workspace. Never crosses the boundary. */
  listIdentities(workspaceId: string, limit = 500): ExternalIdentity[] {
    return this.identities.filter((i) => i.workspaceId === workspaceId).slice(-limit).reverse();
  }

  identityFor(
    workspaceId: string,
    provider: string,
    connectionId: string,
    entityType: string,
    entityId: string,
  ): ExternalIdentity | null {
    return this.byProvider.get(providerKey(workspaceId, provider, connectionId, entityType, entityId)) ?? null;
  }

  /** Identities linked to one NeuroPause subject. "Who is this, elsewhere?" */
  identitiesForSubject(workspaceId: string, subjectId: string): ExternalIdentity[] {
    return this.identities.filter((i) => i.workspaceId === workspaceId && i.subject?.id === subjectId);
  }

  /**
   * Record or update a provider identity.
   *
   * Idempotent on the four-field provider key, so a sync that sees the same
   * object again updates one row rather than growing the file forever.
   */
  async upsertIdentity(input: {
    workspaceId: string;
    provider: string;
    connectionId: string;
    providerAccountId: string | null;
    providerEntityType: string;
    providerEntityId: string;
    displayName: string;
    email: string | null;
    state: IdentityState;
    subject: IdentitySubject | null;
    evidence: IdentityEvidence[];
    confirmedBy?: string | null;
  }): Promise<ExternalIdentity> {
    await this.load();
    const key = providerKey(
      input.workspaceId,
      input.provider,
      input.connectionId,
      input.providerEntityType,
      input.providerEntityId,
    );
    const at = this.now();
    const existing = this.byProvider.get(key);

    if (existing) {
      existing.displayName = input.displayName;
      existing.email = input.email;
      existing.state = input.state;
      existing.subject = input.subject;
      existing.evidence = input.evidence;
      /**
       * NEVER erased by a caller that does not know it.
       *
       * Every decision path passes `providerAccountId: null` because a person
       * confirming a match has no idea what the provider's account id is.
       * Assigning that unconditionally wiped a value the sync had established.
       */
      existing.providerAccountId = input.providerAccountId ?? existing.providerAccountId;
      if (input.confirmedBy !== undefined && input.confirmedBy !== null) {
        existing.confirmedBy = input.confirmedBy;
        existing.confirmedAt = at;
      }
      existing.updatedAt = at;
      await this.persist();
      return existing;
    }

    const identity: ExternalIdentity = {
      id: `xid_${randomUUID()}`,
      workspaceId: input.workspaceId,
      provider: input.provider,
      connectionId: input.connectionId,
      providerAccountId: input.providerAccountId,
      providerEntityType: input.providerEntityType,
      providerEntityId: input.providerEntityId,
      displayName: input.displayName,
      email: input.email,
      state: input.state,
      subject: input.subject,
      evidence: input.evidence,
      confirmedBy: input.confirmedBy ?? null,
      confirmedAt: input.confirmedBy ? at : null,
      createdAt: at,
      updatedAt: at,
    };
    this.identities.push(identity);
    this.byProvider.set(key, identity);
    this.evictIdentities(input.workspaceId);
    await this.persist();
    return identity;
  }

  /**
   * Break the association, keep the identity.
   *
   * Unlinking must never delete the canonical record or the external identity:
   * the provider object still exists, and the history of having been linked is
   * part of how the record's provenance is explained.
   */
  async unlink(workspaceId: string, identityId: string): Promise<ExternalIdentity | null> {
    await this.load();
    const identity = this.identities.find((i) => i.id === identityId && i.workspaceId === workspaceId);
    if (!identity) return null;
    identity.subject = null;
    identity.state = 'unknown';
    identity.confirmedBy = null;
    identity.confirmedAt = null;
    identity.updatedAt = this.now();
    await this.persist();
    return identity;
  }

  /** Mark every identity of a connection revoked. Kept, never deleted. */
  async revokeConnection(workspaceId: string, connectionId: string): Promise<number> {
    await this.load();
    let n = 0;
    for (const identity of this.identities) {
      if (identity.workspaceId !== workspaceId || identity.connectionId !== connectionId) continue;
      if (identity.state === 'revoked') continue;
      identity.state = 'revoked';
      identity.updatedAt = this.now();
      n += 1;
    }
    if (n > 0) await this.persist();
    return n;
  }

  /* ── The match queue ───────────────────────────────────────────────────── */

  /** Questions awaiting a person, worst first. */
  queue(workspaceId: string, limit = 200): IdentityMatch[] {
    const rank = (m: IdentityMatch): number => (m.state === 'ambiguous' ? 0 : 1);
    return this.matches
      .filter((m) => m.workspaceId === workspaceId)
      .sort((a, b) => rank(a) - rank(b) || a.firstSeenAt.localeCompare(b.firstSeenAt))
      .slice(0, Math.max(1, Math.min(limit, 500)));
  }

  matchById(workspaceId: string, id: string): IdentityMatch | null {
    return this.matches.find((m) => m.id === id && m.workspaceId === workspaceId) ?? null;
  }

  counts(workspaceId: string): { ambiguous: number; unknown: number; linked: number } {
    const mine = this.matches.filter((m) => m.workspaceId === workspaceId);
    return {
      ambiguous: mine.filter((m) => m.state === 'ambiguous').length,
      unknown: mine.filter((m) => m.state === 'unknown').length,
      linked: this.identities.filter((i) => i.workspaceId === workspaceId && i.state === 'known').length,
    };
  }

  /**
   * Raise, or re-raise, a question.
   *
   * Idempotent on the provider key: a sync every fifteen minutes must not
   * produce a thousand copies of the same question. `seenCount` rises instead,
   * which is itself a signal — a question asked forty times is a question
   * nobody is answering.
   */
  async raiseMatch(input: {
    workspaceId: string;
    provider: string;
    connectionId: string;
    providerEntityType: string;
    providerEntityId: string;
    incomingLabel: string;
    incoming: { field: string; label: string; value: string }[];
    destinationModuleId: string;
    destinationLabel: string;
    candidates: IdentityCandidate[];
    state: 'ambiguous' | 'unknown';
    reason: string;
  }): Promise<IdentityMatch> {
    await this.load();
    const key = providerKey(
      input.workspaceId,
      input.provider,
      input.connectionId,
      input.providerEntityType,
      input.providerEntityId,
    );
    const at = this.now();
    const existing = this.matchByProvider.get(key);
    if (existing) {
      existing.candidates = input.candidates;
      existing.incoming = input.incoming;
      existing.incomingLabel = input.incomingLabel;
      existing.state = input.state;
      existing.reason = input.reason;
      existing.lastSeenAt = at;
      existing.seenCount += 1;
      await this.persist();
      return existing;
    }
    const match: IdentityMatch = {
      id: `idm_${randomUUID()}`,
      workspaceId: input.workspaceId,
      provider: input.provider,
      connectionId: input.connectionId,
      providerEntityType: input.providerEntityType,
      providerEntityId: input.providerEntityId,
      incomingLabel: input.incomingLabel,
      incoming: input.incoming,
      destinationModuleId: input.destinationModuleId,
      destinationLabel: input.destinationLabel,
      candidates: input.candidates,
      state: input.state,
      reason: input.reason,
      firstSeenAt: at,
      lastSeenAt: at,
      seenCount: 1,
    };
    this.matches.push(match);
    this.matchByProvider.set(key, match);
    this.evictMatches(input.workspaceId);
    await this.persist();
    log.info('Identity question raised', {
      provider: input.provider,
      entityType: input.providerEntityType,
      state: input.state,
      candidates: input.candidates.length,
    });
    return match;
  }

  /** Retire a question once it has been answered. */
  async retireMatch(workspaceId: string, matchId: string): Promise<void> {
    await this.load();
    const index = this.matches.findIndex((m) => m.id === matchId && m.workspaceId === workspaceId);
    if (index < 0) return;
    const [removed] = this.matches.splice(index, 1);
    if (removed) {
      this.matchByProvider.delete(
        providerKey(
          removed.workspaceId,
          removed.provider,
          removed.connectionId,
          removed.providerEntityType,
          removed.providerEntityId,
        ),
      );
    }
    await this.persist();
  }

  /* ── Service identities ────────────────────────────────────────────────── */

  listServices(workspaceId: string): ServiceIdentity[] {
    return this.services.filter((s) => s.workspaceId === workspaceId);
  }

  serviceById(id: string): ServiceIdentity | null {
    return this.services.find((s) => s.id === id) ?? null;
  }

  /**
   * Register a service identity, or update its purpose and scopes.
   *
   * Keyed by id so the composition root can declare the same service on every
   * boot without accumulating copies. Permissions are REPLACED, not merged: a
   * scope removed from the declaration must actually go away, or narrowing a
   * service's authority would be impossible.
   */
  async registerService(input: {
    id: string;
    purpose: string;
    permissions: ServiceIdentity['permissions'];
    workspaceId: string;
  }): Promise<ServiceIdentity> {
    await this.load();
    const existing = this.services.find((s) => s.id === input.id);
    if (existing) {
      existing.purpose = input.purpose;
      existing.permissions = [...input.permissions];
      existing.workspaceId = input.workspaceId;
      await this.persist();
      return existing;
    }
    const service: ServiceIdentity = {
      id: input.id,
      purpose: input.purpose,
      permissions: [...input.permissions],
      workspaceId: input.workspaceId,
      status: 'active',
      createdAt: this.now(),
      lastUsedAt: null,
      lastAction: null,
    };
    this.services.push(service);
    await this.persist();
    return service;
  }

  /** Record that a service acted. Fire-and-forget; never blocks the action. */
  noteServiceUse(id: string, action: string): void {
    const service = this.services.find((s) => s.id === id);
    if (!service) return;
    service.lastUsedAt = this.now();
    service.lastAction = action;
    void this.persist();
  }

  async setServiceStatus(id: string, status: ServiceIdentity['status']): Promise<ServiceIdentity | null> {
    await this.load();
    const service = this.services.find((s) => s.id === id);
    if (!service) return null;
    service.status = status;
    await this.persist();
    return service;
  }

  /* ── Eviction ──────────────────────────────────────────────────────────── */

  /**
   * Caps are PER WORKSPACE, and evicting says so out loud.
   *
   * A global cap makes one workspace's noise another workspace's data loss: a
   * chatty connector in workspace A would push workspace B's UNANSWERED
   * questions off the front of a shared array. That is the boundary this whole
   * program exists to draw, breached by an array length.
   *
   * Evicting an unanswered question is a real loss, so it is logged rather than
   * absorbed. Reaching this cap at all means something is generating questions
   * faster than anyone can answer them, which is itself the finding.
   */
  private evictMatches(workspaceId: string): void {
    const mine = this.matches.filter((m) => m.workspaceId === workspaceId);
    if (mine.length <= MAX_MATCHES) return;
    const drop = mine.slice(0, mine.length - MAX_MATCHES);
    const doomed = new Set(drop);
    this.matches = this.matches.filter((m) => !doomed.has(m));
    for (const d of drop) {
      this.matchByProvider.delete(
        providerKey(d.workspaceId, d.provider, d.connectionId, d.providerEntityType, d.providerEntityId),
      );
    }
    log.warn('Dropped the oldest unanswered identity questions to stay within the cap', {
      workspaceId,
      dropped: drop.length,
      cap: MAX_MATCHES,
    });
  }

  private evictIdentities(workspaceId: string): void {
    const mine = this.identities.filter((i) => i.workspaceId === workspaceId);
    if (mine.length <= MAX_IDENTITIES) return;
    const drop = mine.slice(0, mine.length - MAX_IDENTITIES);
    const doomed = new Set(drop);
    this.identities = this.identities.filter((i) => !doomed.has(i));
    for (const d of drop) {
      this.byProvider.delete(
        providerKey(d.workspaceId, d.provider, d.connectionId, d.providerEntityType, d.providerEntityId),
      );
    }
    log.warn('Dropped the oldest external identities to stay within the cap', {
      workspaceId,
      dropped: drop.length,
      cap: MAX_IDENTITIES,
    });
  }

  /* ── Persistence ───────────────────────────────────────────────────────── */

  private persist(): Promise<void> {
    // Serialised, with a unique temp name: two concurrent syncs raising
    // questions must not interleave a stale snapshot over a fresh one.
    this.writeChain = this.writeChain.then(() => this.writeNow()).catch(() => undefined);
    return this.writeChain;
  }

  private async writeNow(): Promise<void> {
    const payload: IdentityFile = {
      ...envelopeStamp(),
      identities: this.identities,
      matches: this.matches,
      services: this.services,
    };
    const tmp = `${this.filePath}.${process.pid}.${(this.tmpSeq += 1)}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(payload), { mode: 0o600 });
      await fs.rename(tmp, this.filePath);
    } catch (err) {
      // An identity record that fails to persist must not fail the sync that
      // produced it — the question is re-raised on the next pass.
      log.warn('Failed to persist identity store', { err: err instanceof Error ? err.message : String(err) });
    }
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }
}

/** Confidence for a candidate, from its evidence. Never from a model. */
export function candidateConfidence(evidence: readonly IdentityEvidence[]): number {
  return scoreEvidence(evidence);
}
