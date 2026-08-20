/**
 * Durable, non-secret persistence of connected-account metadata.
 *
 * This is the companion to the encrypted vault: the vault holds tokens, this
 * holds everything else about a connection (label, status, granted scopes, sync
 * timestamps). Persisted as plain JSON in userData because it contains no
 * secrets — only what the Connectors UI renders. Since NP-013 that sentence is
 * ENFORCED, not assumed: both doors (load + upsert) scrub credential-shaped
 * values through `metadataCredentialGuard` (RULE-009).
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { ConnectedAccount, SyncState } from '@neuropause/shared';
import { createLogger } from '../logger';
import { declareStoreScope } from '../tenancy/storeScope';
import { scrubAccountMetadata } from './metadataCredentialGuard';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'connector-accounts',
  scope: 'WORKSPACE',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  /** P13C ROUND 10 — the checkable form, and see `remove` for what changed. */
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'No cap, no TTL, no eviction: nothing is ever removed to make room, so no workspace\'s volume ' +
    'reaches another\'s connections. ONE removal, `remove(connectorId, accountId)`, which now ' +
    'resolves the account through the workspace-scoped `get()` BEFORE deleting — Round 10; it was ' +
    'a bare `accounts.delete(connectorId::accountId)` whose only ownership check lived in its single ' +
    'caller. An account written before the workspace boundary existed is UNCLAIMED, is returned by ' +
    'no scoped read, and is therefore removable by nobody through this path; `unclaimed()` surfaces ' +
    'it so an operator can reconnect instead.',
  reason: "ConnectedAccount.workspaceId, and unbound returns []. An account label and its granted scopes describe a customer's own SaaS connection.",
});

const log = createLogger('connector-store');

function storePath(): string {
  return join(app.getPath('userData'), 'connectors.json');
}

class ConnectorStore {
  private accounts = new Map<string, ConnectedAccount>();
  private loaded = false;

  private key(connectorId: string, accountId: string): string {
    return `${connectorId}::${accountId}`;
  }

  /**
   * Loads persisted accounts once. Safe to call repeatedly.
   *
   * NP-013 / RULE-009 — the READ door scrubs too: a credential-shaped value
   * already on disk (smuggled before the guard existed, or hand-edited) must
   * not round-trip forever. If anything was scrubbed, the cleaned set is
   * persisted back immediately so the file itself stops carrying the bytes.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    let scrubbedOnLoad = false;
    try {
      const raw = await fs.readFile(storePath(), 'utf8');
      const list = JSON.parse(raw) as ConnectedAccount[];
      if (Array.isArray(list)) {
        for (const a of list) {
          if (a && a.id && a.connectorId) {
            const { account, scrubbedFields } = scrubAccountMetadata(a);
            if (scrubbedFields.length > 0) {
              scrubbedOnLoad = true;
              log.warn('RULE-009: credential-shaped material scrubbed from stored connector metadata', {
                connectorId: account.connectorId,
                accountId: account.id,
                fields: scrubbedFields,
              });
            }
            this.accounts.set(this.key(account.connectorId, account.id), account);
          }
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to read connectors store; starting empty', err);
      }
    }
    this.loaded = true;
    if (scrubbedOnLoad) await this.persist();
  }

  private async persist(): Promise<void> {
    const tmp = `${storePath()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify([...this.accounts.values()], null, 2), { mode: 0o600 });
    await fs.rename(tmp, storePath());
  }

  /**
   * P10 — the workspace whose connections are visible.
   *
   * Injected rather than imported so this store keeps no dependency on the
   * enterprise subsystem, and set once at composition. Until it is set, the
   * store answers with NOTHING rather than everything: a reader that does not
   * know which workspace it is in has no business seeing a connection.
   */
  private workspaceId: (() => string) | null = null;

  bindWorkspace(fn: () => string): void {
    this.workspaceId = fn;
  }

  private activeWorkspace(): string | null {
    return this.workspaceId?.() ?? null;
  }

  /**
   * Every connected account IN THE ACTIVE WORKSPACE.
   *
   * A record with no `workspaceId` was written before the boundary existed and
   * is UNCLAIMED — never returned. Its credential is unspendable for the same
   * reason (see `connectorVault.migrationRequired`), so listing it as
   * connected would promise a sync that cannot happen.
   */
  all(): ConnectedAccount[] {
    const workspace = this.activeWorkspace();
    if (workspace === null) return [];
    return [...this.accounts.values()].filter((a) => a.workspaceId === workspace);
  }

  /** Accounts for one connector, in the active workspace. */
  byConnector(connectorId: string): ConnectedAccount[] {
    return this.all().filter((a) => a.connectorId === connectorId);
  }

  /**
   * Every account in ONE ORGANIZATION, across all of its workspaces.
   *
   * P13C ROUND 8 — FINDING 7. THE ORGANIZATION BRIEF WAS ALWAYS ZERO.
   *
   * `collectOrgHealthInputs` called `all()`, which filters on the ACTIVE
   * WORKSPACE — and the scheduled brief runs under a tenant-level background
   * principal whose `workspaceId` is `''`. So `connectorsTotal`,
   * `connectorsHealthy` and `connectorsError` were 0 in every brief, for every
   * tenant, forever. Every isolation assertion over those fields passed
   * VACUOUSLY, because zero is equal to zero.
   *
   * The intended semantic is organization-wide: "how healthy are this
   * organization's integrations" is not a per-workspace question, and a brief
   * that reported one workspace's connectors as the organization's would be a
   * different wrong answer.
   *
   * This is why the resolver is passed EXPLICITLY rather than read from the
   * ambient workspace: the caller states which organization it is asking about,
   * and there is no value of the active workspace that makes the question
   * answerable.
   */
  forOrganization(workspaceIdsInOrg: readonly string[]): ConnectedAccount[] {
    if (workspaceIdsInOrg.length === 0) return [];
    const wanted = new Set(workspaceIdsInOrg);
    return [...this.accounts.values()].filter(
      (a) => a.workspaceId !== undefined && wanted.has(a.workspaceId),
    );
  }

  /**
   * Accounts written before workspaces were a boundary.
   *
   * Surfaced so an operator can see they exist and reconnect. Deliberately not
   * adopted into the active workspace — that is the guess this change removes.
   */
  unclaimed(): ConnectedAccount[] {
    return [...this.accounts.values()].filter((a) => a.workspaceId === undefined);
  }

  /**
   * One account, IF it belongs to the active workspace.
   *
   * The single most important line in this file: an id from one workspace must
   * not resolve in another. Every read path — the supervisor, the webhook
   * router, the sync orchestrator, the M365 scope check — goes through here or
   * through `all()`, so scoping both is scoping all seven external callers.
   */
  get(connectorId: string, accountId: string): ConnectedAccount | null {
    const found = this.accounts.get(this.key(connectorId, accountId)) ?? null;
    if (found === null) return null;
    const workspace = this.activeWorkspace();
    if (workspace === null || found.workspaceId !== workspace) return null;
    return found;
  }

  /** Ignores the workspace. For the owning service's own bookkeeping only. */
  getAnyWorkspace(connectorId: string, accountId: string): ConnectedAccount | null {
    return this.accounts.get(this.key(connectorId, accountId)) ?? null;
  }

  /**
   * Inserts or replaces an account and persists.
   *
   * NP-013 / RULE-009 — THE WRITE DOOR. `patch`/`setSync`/`persistConnected`
   * and the e2e seed all route through here, so scrubbing this one method
   * guards every metadata write. Scrub, never refuse: a hostile provider must
   * not be able to DoS the connection flow by shaping its workspace name like
   * a token. The evidence line names the FIELD, never the value.
   */
  async upsert(account: ConnectedAccount): Promise<ConnectedAccount> {
    const { account: safe, scrubbedFields } = scrubAccountMetadata(account);
    if (scrubbedFields.length > 0) {
      log.warn('RULE-009: credential-shaped material scrubbed from connector metadata', {
        connectorId: safe.connectorId,
        accountId: safe.id,
        fields: scrubbedFields,
      });
    }
    this.accounts.set(this.key(safe.connectorId, safe.id), safe);
    await this.persist();
    return safe;
  }

  /** Applies a partial update to an existing account. */
  async patch(
    connectorId: string,
    accountId: string,
    patch: Partial<ConnectedAccount>,
  ): Promise<ConnectedAccount | null> {
    const existing = this.get(connectorId, accountId);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    return this.upsert(next);
  }

  async setSync(
    connectorId: string,
    accountId: string,
    state: SyncState,
    at: string | null,
  ): Promise<ConnectedAccount | null> {
    return this.patch(connectorId, accountId, {
      lastSyncState: state,
      lastSyncAt: at ?? this.get(connectorId, accountId)?.lastSyncAt ?? null,
    });
  }

  /**
   * Remove one account — IF it belongs to the active workspace.
   *
   * P13C ROUND 10. This was `accounts.delete(this.key(connectorId, accountId))`
   * on a bare pair, and the pair arrives from a renderer payload through
   * `connectorService.disconnect`. The ownership check existed, but it existed in
   * the CALLER, which is the arrangement this program has repeatedly found to be
   * one refactor away from a cross-workspace delete: `get()` and `all()` are
   * scoped, `getAnyWorkspace()` is named for the fact that it is not, and this
   * primitive silently behaved like the third while reading like the first.
   *
   * The check is the store's own now, on the same resolver every read uses, so
   * there is no ordering a future caller can choose that removes another
   * workspace's connection. Refusing rather than throwing keeps the existing
   * `Promise<void>` contract: the only production caller has already resolved the
   * account through `get()` in the same operation, so this cannot refuse a
   * legitimate disconnect.
   */
  async remove(connectorId: string, accountId: string): Promise<void> {
    if (this.get(connectorId, accountId) === null) return;
    if (this.accounts.delete(this.key(connectorId, accountId))) await this.persist();
  }
}

export const connectorStore = new ConnectorStore();
