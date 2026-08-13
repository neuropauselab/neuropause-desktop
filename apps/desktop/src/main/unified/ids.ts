/**
 * Unified Identifier construction. A record's UDM id is derived deterministically
 * from its source coordinates so re-syncing the same provider object always maps
 * to the same canonical entity (the basis for incremental sync + conflict
 * resolution). Account-scoped so two accounts of the same connector never alias.
 *
 * P13B — THE TENANT IS PART OF THE IDENTITY DOMAIN.
 *
 * It was not, and that was a correctness bug before it was a security one. The
 * id was `connector:account:kind:source`, so two tenants connecting the SAME
 * provider account produced the SAME id for the same provider object — one row
 * in a Map keyed by id. `upsertMany`'s last-updated-wins merge then resolved
 * between two tenants' copies of that record, and whichever synced later owned
 * it. No filter could have fixed that: the two records could not coexist.
 *
 * The collision propagated outward, because two downstream ids are functions of
 * this one:
 *
 *   memory:  `mem:${entityId}`            (memoryProjector)
 *   graph:   node id derived from entity  (graph projector)
 *
 * which is exactly the deterministic-projected-id collision Program 13A
 * recorded as a known limitation it could not fix from inside Memory. Putting
 * the tenant in the identity domain here fixes all three at once, which is why
 * it belongs here rather than in three separate patches downstream.
 *
 * DETERMINISM IS PRESERVED — that is the whole constraint. The same tenant
 * re-syncing the same provider object still derives the same id, so incremental
 * sync, conflict resolution and idempotency are unchanged. What changed is that
 * the function is now injective across tenants as well as across accounts.
 */
import type { UnifiedEntityKind } from '@neuropause/shared';

/**
 * Build a Unified Identifier.
 *
 * `tenantId` is REQUIRED and comes first, so the compiler enumerates every
 * construction site rather than leaving one silently producing the old,
 * collidable shape. An empty tenant is refused for the same reason an unowned
 * record is: a record nobody owns is one everybody's filter has to special-case.
 *
 * The parts are JSON-encoded rather than joined on ':', because a connector id,
 * account id or source id containing the separator could otherwise make two
 * different coordinate tuples collapse to the same string — the same forgery
 * `tenantKey` avoids, and one this file previously permitted.
 */
export function makeUnifiedId(
  tenantId: string,
  connectorId: string,
  accountId: string,
  kind: UnifiedEntityKind,
  sourceId: string,
): string {
  if (!tenantId) {
    throw new Error('Cannot build a Unified Identifier without a tenant: it would have no owner.');
  }
  return JSON.stringify([tenantId, connectorId, accountId, kind, sourceId]);
}
