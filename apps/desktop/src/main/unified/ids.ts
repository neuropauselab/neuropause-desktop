/**
 * Unified Identifier construction. A record's UDM id is derived deterministically
 * from its source coordinates so re-syncing the same provider object always maps
 * to the same canonical entity (the basis for incremental sync + conflict
 * resolution). Account-scoped so two accounts of the same connector never alias.
 */
import type { UnifiedEntityKind } from '@neuropause/shared';

export function makeUnifiedId(
  connectorId: string,
  accountId: string,
  kind: UnifiedEntityKind,
  sourceId: string,
): string {
  return `${connectorId}:${accountId}:${kind}:${sourceId}`;
}
