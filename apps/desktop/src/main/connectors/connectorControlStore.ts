/**
 * P4.1 — durable operator control flags for connectors.
 *
 * Companion to `connectorStore` (account metadata) and `connectorVault` (tokens): this holds the
 * two operator flags the Runtime Supervisor projects into `paused` / `disabled` runtime states —
 * `paused` per account (sync suspended, session kept) and `disabled` per connector (whole connector
 * off). No secrets; plain JSON in userData, atomic write, same discipline as `connectorStore`.
 * Additive and self-contained: nothing else changes shape.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { DEFAULT_CONTROL_STATE, type ConnectorControlState } from '@neuropause/shared';
import { createLogger } from '../logger';
import { declareStoreScope } from '../tenancy/storeScope';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'connector-control-flags',
  scope: 'WORKSPACE',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'INSTALL_METADATA',
  /**
   * P13C ROUND 10 — NEW FINDING, FOUND BY BEING MADE TO ANSWER THIS QUESTION.
   *
   * Round 8's `retention` line on this store read, in full:
   *
   *   "No cap. A legacy pre-boundary flag is cleared INSTALL-WIDE only on an
   *    explicit re-enable, which is the sole way an operator can clear one."
   *
   * That is a WORKSPACE-scoped store stating, in prose, that one of its removals
   * reached install-wide — written down, reviewed, and shipped, because prose
   * cannot be checked. `retentionScope: 'INSTALL'` on a `WORKSPACE` store now
   * throws, so the sentence had to become either a lie or a fix. It is a fix:
   * see `legacyCleared` and `setDisabled`.
   */
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'No cap, no TTL, no eviction: nothing is ever removed to make room, so no workspace\'s volume ' +
    'can reach another\'s flag. THREE removals, each named. (1) `setPaused(…, false)` deletes ' +
    '`connectorId::accountId`; account ids are minted locally by `shortId(\'acct\')` — eight random ' +
    'bytes — so that key names one connection in one workspace in fact and not merely by ' +
    'convention, and the supervisor resolves the account through the workspace-scoped ' +
    '`connectorStore.get` before it ever reaches here. (2) `setDisabled(…, false)` deletes ' +
    '`workspaceId::connectorId`, which carries the owning workspace in the key. (3) Re-disabling ' +
    'drops that same workspace\'s own legacy clearance. The install-wide legacy flag itself is ' +
    'NEVER deleted by anybody — see `legacyCleared`.',
  reason: 'Two booleans per connector/account and no customer content. The disable key is workspaceId::connectorId — a connected account belongs to one workspace, narrower than its organization.',
});

const log = createLogger('connector-controls');

interface ControlsFile {
  /** `connectorId::accountId` keys of paused accounts. */
  pausedAccounts: string[];
  /** connectorId keys of disabled connectors. */
  disabledConnectors: string[];
  /**
   * `workspaceId::connectorId` keys whose workspace has cleared the legacy,
   * pre-boundary install-wide disable for ITSELF. P13C ROUND 10.
   *
   * Absent in every file written before Round 10, which reads as "nobody has
   * cleared anything" — the safe direction: the kill switch stays on until an
   * operator turns it off in their own workspace.
   */
  legacyClearedDisables?: string[];
}

function storePath(): string {
  return join(app.getPath('userData'), 'connector-controls.json');
}

export class ConnectorControlStore {
  /**
   * Where the flags live. Injectable so this store is testable OUTSIDE Electron —
   * `app.getPath` is unavailable in a node test, and a boundary that can only be
   * exercised through the full app is a boundary that does not get exercised.
   */
  constructor(private readonly pathOverride?: string) {}
  private path(): string {
    return this.pathOverride ?? storePath();
  }

  private paused = new Set<string>();
  private disabled = new Set<string>();
  /**
   * `workspaceId::connectorId` for each workspace that has cleared the LEGACY
   * install-wide disable for itself. P13C ROUND 10 — see `setDisabled`.
   *
   * A per-workspace OVERRIDE rather than a deletion, because the legacy flag is
   * one row that applies to every workspace and no single workspace owns it.
   */
  private legacyCleared = new Set<string>();
  private loaded = false;
  private workspaceId: (() => string) | null = null;

  /**
   * Bind the workspace boundary. Same resolver `connectorStore` uses.
   *
   * P13C ROUND 6 — `disabled` WAS AN INSTALL-WIDE KILL SWITCH REACHABLE FROM ANY
   * TENANT.
   *
   * `paused` was already keyed `connectorId::accountId`, so it was per account and
   * therefore per workspace. `disabled` was keyed on the bare `connectorId` —
   * `'github'`, `'slack'` — and `isSuppressed` consults it inside the per-workspace
   * sync fan-out. So a `connectors:manage` holder in one tenant disabling GitHub
   * stopped GitHub syncing for EVERY tenant on the machine, and re-enabling it
   * restarted a connector another tenant had deliberately turned off.
   *
   * That is a cross-tenant control mutation, not a disclosure — the same shape as
   * `governanceStore.setChainEnabled(id)`, and it went unlisted because the file's
   * own comment declared "disabled is connector-wide" and a confident comment
   * reads as a decision.
   *
   * It IS a real design choice for a single-tenant desktop install. It stops being
   * one the moment two organizations share the process.
   */
  bindWorkspace(fn: () => string): this {
    this.workspaceId = fn;
    return this;
  }

  private key(connectorId: string, accountId: string): string {
    return `${connectorId}::${accountId}`;
  }

  /**
   * The disable key for the ACTIVE workspace.
   *
   * Returns null when unbound or unresolved, which makes `isDisabled` fall back to
   * legacy semantics only — never to a wrong workspace's flag.
   */
  private disableKey(connectorId: string): string | null {
    const ws = this.workspaceId?.();
    return ws ? `${ws}::${connectorId}` : null;
  }

  /**
   * A disable written before this boundary existed: the bare connector id.
   *
   * Legacy entries KEEP APPLYING INSTALL-WIDE, and that is deliberate. A disable
   * is a SAFETY control — an operator turned a connector off, usually because it
   * was misbehaving. Failing closed on data migration normally means "hide it";
   * here "hide it" means silently re-enabling a connector somebody switched off,
   * which fails in the dangerous direction. So old flags keep their old meaning
   * until an operator sets one again, at which point it becomes per workspace.
   *
   * P13C ROUND 10 — THE CLEARANCE IS PER WORKSPACE, THE FLAG IS NEVER DELETED.
   *
   * A workspace that re-enables the connector records a clearance for ITSELF and
   * the shared row survives, so every other workspace's kill switch stays on.
   * An UNRESOLVED workspace has no clearance to consult and gets the flag — the
   * same fail-safe direction the paragraph above argues for.
   */
  private legacyDisabled(connectorId: string): boolean {
    if (!this.disabled.has(connectorId)) return false;
    const k = this.disableKey(connectorId);
    return k === null || !this.legacyCleared.has(k);
  }

  /** Loads persisted flags once. Safe to call repeatedly. */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.path(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<ControlsFile>;
      if (Array.isArray(parsed.pausedAccounts)) this.paused = new Set(parsed.pausedAccounts.filter((s) => typeof s === 'string'));
      if (Array.isArray(parsed.disabledConnectors)) this.disabled = new Set(parsed.disabledConnectors.filter((s) => typeof s === 'string'));
      if (Array.isArray(parsed.legacyClearedDisables)) this.legacyCleared = new Set(parsed.legacyClearedDisables.filter((s) => typeof s === 'string'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to read connector controls; starting empty', err);
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const data: ControlsFile = {
      pausedAccounts: [...this.paused],
      disabledConnectors: [...this.disabled],
      legacyClearedDisables: [...this.legacyCleared],
    };
    const tmp = `${this.path()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.path());
  }

  /** The effective control state for an account. Disabled is per WORKSPACE. */
  controlFor(connectorId: string, accountId: string): ConnectorControlState {
    if (!this.loaded) return DEFAULT_CONTROL_STATE;
    return {
      paused: this.paused.has(this.key(connectorId, accountId)),
      disabled: this.isDisabled(connectorId),
    };
  }

  isDisabled(connectorId: string): boolean {
    const k = this.disableKey(connectorId);
    // The workspace's own flag, or a pre-boundary install-wide one. See above.
    return (k !== null && this.disabled.has(k)) || this.legacyDisabled(connectorId);
  }

  /** True when sync must be suppressed for this account (paused OR its connector disabled). */
  isSuppressed(connectorId: string, accountId: string): boolean {
    const c = this.controlFor(connectorId, accountId);
    return c.paused || c.disabled;
  }

  async setPaused(connectorId: string, accountId: string, paused: boolean): Promise<void> {
    const k = this.key(connectorId, accountId);
    const changed = paused ? !this.paused.has(k) : this.paused.has(k);
    if (!changed) return;
    if (paused) this.paused.add(k);
    else this.paused.delete(k);
    await this.persist();
  }

  /**
   * Disable or re-enable a connector FOR THE ACTIVE WORKSPACE.
   *
   * P13C ROUND 10 — NEW FINDING. RE-ENABLING USED TO CLEAR EVERY WORKSPACE'S
   * KILL SWITCH.
   *
   * The line this replaces was:
   *
   *     this.disabled.delete(k);
   *     this.disabled.delete(connectorId); // clear the pre-boundary flag too
   *
   * The second delete removed the LEGACY, pre-boundary flag — the bare
   * `connectorId` key that `legacyDisabled` applies to EVERY workspace on the
   * machine. So a `connectors:manage` holder in workspace A pressing "enable" on
   * GitHub silently restarted GitHub sync for workspace B, in a different
   * organization, which had deliberately turned it off. It is the same
   * cross-tenant control mutation Round 6 found in `isDisabled` and fixed on the
   * READ side, left live on the WRITE side by the very line that was added to
   * make the fix usable — the shape this program keeps finding: a filter hides,
   * a delete destroys, and the delete is the half that survives review because
   * the neighbouring code is correct.
   *
   * A per-workspace CLEARANCE rather than a delete. The legacy row belongs to
   * nobody — it predates the boundary — so no single workspace may remove it;
   * each may only record that it does not apply to itself. The operator's
   * intent is served in full (their connector runs), every other workspace's
   * safety control survives, and on a single-workspace install the observable
   * behaviour is byte-for-byte the old one.
   *
   * An unresolved workspace CANNOT disable. A kill switch with no owner is how the
   * install-wide one got here.
   */
  async setDisabled(connectorId: string, disabled: boolean): Promise<void> {
    const k = this.disableKey(connectorId);
    if (k === null) {
      // THROW, do not return. `Promise<void>` resolving looks like success to the
      // IPC caller, so a silent return tells an operator the connector is off when
      // it is running. The rest of this program's writes throw when unresolved;
      // a control that reports a state it did not reach is worse than a refusal.
      throw new Error('No workspace is active, so this connector cannot be disabled.');
    }
    const before = this.disabled.has(k) || this.legacyDisabled(connectorId);
    if (before === disabled) return;
    if (disabled) {
      this.disabled.add(k);
      // Its own clearance, so the two flags cannot disagree. Nobody else's row.
      this.legacyCleared.delete(k);
    } else {
      this.disabled.delete(k);
      // The legacy install-wide flag is NOT deleted. This workspace records that
      // it no longer applies HERE; every other workspace keeps its kill switch.
      this.legacyCleared.add(k);
    }
    await this.persist();
  }
}

export const connectorControlStore = new ConnectorControlStore();
