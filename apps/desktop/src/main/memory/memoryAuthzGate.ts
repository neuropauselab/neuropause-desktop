/**
 * THE MEMORY CHANNEL FAMILY'S AUTHORITY MAP. P13C ROUND 9 — F20.
 *
 * THE FINDING
 *
 * `memory:exec-forget` and `memory:exec-pin` were on `PUBLIC_CHANNELS` — no auth,
 * no permission — while `memory:forget`, which reaches THE SAME `MemoryStore` by a
 * different route, required `operations:manage`. Two doors to one resource with
 * different locks, and the unlocked one is the destructive one: `forgetMemory`
 * calls `memoryStore.forget`, which is the same deletion `memory:forget` performs.
 * `memory:exec-resolve` sat beside them and reaches `memoryStore.update`.
 *
 * HOW THE ANSWER WAS DERIVED — RESOURCE, OPERATION, SCOPE, AUTHORITY
 *
 * Not from the channel's name. Every row below was resolved by following the
 * handler to the store behind it and reading that store's own declaration:
 *
 *   RESOURCE   `ai-memory-store` (memoryStore.ts) and `memory-audit-log`
 *              (memoryAuditLog.ts) — the only two stores this family touches.
 *   SCOPE      TENANT, for both. Declared in `declareStoreScope` / `TenantOwnership`.
 *   AUTHORITY  ORG_ROLE, for both. Declared alongside the scope.
 *   OPERATION  read / write / delete / update, per handler.
 *
 * Because the scope is TENANT and the declared authority is ORG_ROLE, an
 * ORGANIZATION permission is the RIGHT AXIS here and `cloud:operate` would be the
 * wrong one — this family holds one tenant's own records, not a shared machine
 * resource. That is the same test applied in `ai/aiAuthzGate.ts`, where it comes
 * out the other way because the resource there is one install-wide config file.
 * The defect was never the axis; it was that three doors had no lock at all.
 *
 * WHICH PERMISSION, AND WHY NOT A NEW ONE
 *
 * The sibling operation on the same store already answers it: writes and deletions
 * take `operations:manage` (`memory:remember` / `memory:forget` / `memory:backfill`
 * / `memory:rebuild`), content reads take `intelligence:read` (`memory:recall` /
 * `memory:semantic-recall` / `memory:exec-audit`). Reusing them keeps ONE lock per
 * resource; a new `memory:manage` scope would be a second thing to forget to check
 * and a second thing to grant.
 *
 * THE SHAPE: the house pattern from `workforce/authzGate.ts` — a per-family map
 * that THROWS at composition time when a channel in the family ships
 * unclassified, so a new `memory:*` channel cannot reach a renderer by omission.
 * `PUBLIC` is a value in the map rather than an absence, because "nobody wrote a
 * row" and "somebody decided this is open" must not look the same.
 */
import { IpcChannel } from '@neuropause/shared';
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { RUNTIME_CHANNEL_PERMISSIONS } from '../ipc/runtimeAuthz';

/**
 * What a channel demands: a permission, or an explicit decision that it is open.
 *
 * `'PUBLIC'` is deliberately a value and not `undefined`. An undefined entry means
 * "unclassified" and throws; a channel is only open because someone wrote the word.
 */
export type ChannelAuthority = EnterprisePermission | 'PUBLIC';

/** Every invokable `memory:*` channel → the authority it requires. */
export const MEMORY_CHANNEL_AUTHORITY: Readonly<Partial<Record<IpcChannelName, ChannelAuthority>>> =
  {
    /* ── Content reads of ai-memory-store (TENANT / ORG_ROLE) ──────────────
     * `intelligence:read`, which `memory:recall` already required. Each of these
     * returns MemoryItem bodies — the assistant's remembered summaries of a
     * tenant's records — so they are the same disclosure through a different
     * verb, and the Member role holds this scope.
     */
    [IpcChannel.MemoryRecall]: 'intelligence:read',
    [IpcChannel.MemorySemanticRecall]: 'intelligence:read',
    /**
     * MOVED OFF PUBLIC. `memory:get` returns the whole item for an id, which is
     * exactly what `memory:recall` returns for a query. The store refuses ids it
     * cannot see (`visible`), so this was never a cross-tenant hole — but an
     * unauthenticated renderer message could read remembered content, and the
     * id-shaped door cannot be looser than the query-shaped one.
     */
    [IpcChannel.MemoryGet]: 'intelligence:read',
    /**
     * MOVED OFF PUBLIC. The Memory panel's search over the same store, returning
     * the same bodies as `memory:recall`. Leaving it open while `memory:exec-audit`
     * — the log ABOUT these memories — required `intelligence:read` was incoherent:
     * the record of what was remembered was gated and the memories were not.
     */
    [IpcChannel.ExecMemorySearch]: 'intelligence:read',
    /** Already gated in Round 7: the rows carry assistant-written record titles. */
    [IpcChannel.ExecMemoryAudit]: 'intelligence:read',

    /* ── Writes, deletions and re-indexing of ai-memory-store ──────────────
     * `operations:manage`, which `memory:forget` already required. Manager and
     * above hold it; Member does not.
     */
    [IpcChannel.MemoryRemember]: 'operations:manage',
    [IpcChannel.MemoryForget]: 'operations:manage',
    /** Egress: embeds this tenant's memories into its cloud vector namespace. */
    [IpcChannel.MemoryBackfill]: 'operations:manage',
    /** Replaces the whole projected set — a write that can remove rows. */
    [IpcChannel.MemoryRebuild]: 'operations:manage',
    /**
     * F20 — THE THREE THAT WERE PUBLIC.
     *
     * `exec-forget` → `memoryStore.forget` (the same deletion as `memory:forget`).
     * `exec-pin` and `exec-resolve` → `memoryStore.update` (a metadata write that
     * changes what the assistant surfaces and how a decision reads). All three
     * now carry the lock their sibling on the same store carries.
     */
    [IpcChannel.ExecMemoryForget]: 'operations:manage',
    [IpcChannel.ExecMemoryPin]: 'operations:manage',
    [IpcChannel.ExecMemoryResolve]: 'operations:manage',

    /* ── Deliberately open ─────────────────────────────────────────────────
     * `memory:counts` returns totals and per-kind/per-origin tallies computed
     * through `memoryVisibleTo` for the RESOLVED VIEWER, so it cannot count a row
     * this caller may not read and carries no title, body or id. The shell asks
     * for it to draw a badge before an organization has resolved, and an
     * unresolved viewer counts nothing rather than everything. It stays open, and
     * this row is the record of that decision.
     */
    [IpcChannel.MemoryCounts]: 'PUBLIC',
  };

/**
 * The channels in this family whose handler MUTATES a store.
 *
 * Exported because "is every write in the family gated?" is a question a test
 * should be able to ask structurally rather than by re-listing the channels, and
 * because these are the ones that earn an audit line.
 */
export const MEMORY_WRITE_CHANNELS: ReadonlySet<IpcChannelName> = new Set<IpcChannelName>([
  IpcChannel.MemoryRemember,
  IpcChannel.MemoryForget,
  IpcChannel.MemoryBackfill,
  IpcChannel.MemoryRebuild,
  IpcChannel.ExecMemoryForget,
  IpcChannel.ExecMemoryPin,
  IpcChannel.ExecMemoryResolve,
]);

/**
 * Stamp authority onto every memory handler from the map.
 *
 * THROWS when a `memory:*` def has no row — the ship-time guard. Also throws when
 * a row DISAGREES with `RUNTIME_CHANNEL_PERMISSIONS`: the central runtime table
 * already classifies part of this family, and two tables that can quietly diverge
 * are worse than one table with a gap. A def gated here is skipped by the runtime
 * gate at the composition root (it only stamps defs with no `permission`), so
 * agreement is not automatic and is therefore asserted.
 */
export function withMemoryAuthz(defs: SecureHandlerDef[]): SecureHandlerDef[] {
  return defs.map((def) => {
    const authority = MEMORY_CHANNEL_AUTHORITY[def.channel];
    if (authority === undefined) {
      throw new Error(
        `Memory IPC channel "${def.channel}" has no authority classification. ` +
          'Add it to MEMORY_CHANNEL_AUTHORITY in memory/memoryAuthzGate.ts — the permission ' +
          'its store\'s scope and declared authority require, or PUBLIC with a reason.',
      );
    }
    if (authority === 'PUBLIC') return def;
    const central = RUNTIME_CHANNEL_PERMISSIONS[def.channel];
    if (central !== undefined && central !== authority) {
      throw new Error(
        `Memory IPC channel "${def.channel}" is classified "${authority}" here and ` +
          `"${central}" in ipc/runtimeAuthz.ts. One channel, one lock: reconcile them.`,
      );
    }
    /**
     * `Object.assign` rather than a spread, and that is not a style choice.
     * `SecureHandlerDef` is a ~675-member discriminated union; spreading it while
     * widening `audit` to `boolean` makes the compiler enumerate the product of
     * every channel, every permission and both audit values, which trips TS2590
     * ("union type too complex"). An intersection is computed lazily, so this
     * keeps the union-checked parameter type — which is what enforces each
     * channel's response contract at the composition roots — without paying for
     * it in the return position.
     */
    return Object.assign({}, def, {
      requireAuth: true,
      permission: authority,
      audit: def.audit === true || MEMORY_WRITE_CHANNELS.has(def.channel),
    }) as SecureHandlerDef;
  });
}
