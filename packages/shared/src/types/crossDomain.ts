/**
 * Cross-domain related records — the shapes the renderer and the main process
 * agree on.
 *
 * The algorithm lives in the main process (it needs the relationship store and
 * the record stores); only the result crosses the boundary. Two fields here
 * carry more weight than the rest and are worth reading closely:
 *
 *  - `RelatedHop.why` — the structural reason two records are connected, in
 *    terms of the field and the literal value. Without it a related-records
 *    list is a set of assertions the reader has to trust.
 *  - `hiddenByPermission` — the view is incomplete because the actor cannot
 *    read some module on the other side of a link. It carries no module names
 *    and no counts on purpose: "3 hidden in Finance" would disclose the fact
 *    the permission was protecting. It exists so a filtered view never reads
 *    as a complete one.
 */

/** How the value was matched. Ordered strongest-first, weakest last. */
export type RelatedMatchMethod =
  | 'internal_id'
  | 'business_key'
  | 'normalized_key'
  | 'canonical_name'
  | 'manual';

export interface RelatedHop {
  fromRecordId: string;
  fromTitle: string;
  toRecordId: string;
  toTitle: string;
  relationshipKey: string;
  label: string;
  direction: 'out' | 'in';
  /** The structural basis, verifiable against the record on screen. */
  why: string;
  method: string;
  confidence: number;
  /** Null means nobody chose it — the match was deterministic. */
  decidedBy: string | null;
  /** The literal text the source record carried. Evidence, never overwritten. */
  sourceValue: string;
  at: string;
}

export interface RelatedRecord {
  recordId: string;
  title: string;
  moduleId: string;
  moduleTitle: string;
  /** 1 = directly linked. */
  hops: number;
  /** How the traversal reached this record, in order. */
  path: readonly RelatedHop[];
  /** The far end is gone. Shown rather than hidden — it is information. */
  deleted: boolean;
}

export interface RelatedGroup {
  moduleId: string;
  moduleTitle: string;
  records: readonly RelatedRecord[];
}

export interface RelatedRecordsView {
  root: { recordId: string; title: string; moduleId: string; moduleTitle: string } | null;
  groups: readonly RelatedGroup[];
  total: number;
  depth: number;
  /** At least one link was not followed for want of permission. */
  hiddenByPermission: boolean;
  /** Links whose far end no longer exists. */
  brokenLinks: number;
  /** The record cap was hit; there is more than is shown. */
  truncated: boolean;
}

/** Beyond three hops a "related record" is a rumour. */
export const MAX_RELATED_DEPTH = 3;
export const DEFAULT_RELATED_DEPTH = 2;
/** Total records returned across all hops — one bounded payload. */
export const MAX_RELATED_RECORDS = 200;
