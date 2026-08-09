/**
 * Late binding for the Data Plane relationship store.
 *
 * Same shape, and the same reason, as `decisions/instances.ts`: the enterprise
 * subsystem is composed before the Data Plane exists, but the cross-domain
 * traversal needs the resolved links. Binding at the composition root keeps the
 * dependency one-directional.
 *
 * The failure mode this shape has is worth naming, because governed delete had
 * exactly it: an UNBOUND reader silently reports "nothing is connected", which
 * on a related-records screen is indistinguishable from a record that genuinely
 * has no relations. So the reader returns null rather than an empty store, and
 * the caller renders "the link engine is not running" instead of an empty list.
 */
import type { RelationshipStore } from '../dataPlane/relationshipStore';
import type { RelationshipEngine } from '../dataPlane/relationshipEngine';

let store: RelationshipStore | null = null;
let engine: RelationshipEngine | null = null;

export function bindRelationshipStore(bound: RelationshipStore): void {
  store = bound;
}

/**
 * The engine, for resolving a record's references the moment it changes.
 * Separate from the store because the store is a read for traversal and the
 * engine is a write — different capabilities, bound together only by accident
 * of both living in the Data Plane.
 */
export function bindRelationshipEngine(bound: RelationshipEngine): void {
  engine = bound;
}

/** Null until the Data Plane has initialized. Never an empty stand-in. */
export function relationshipStoreRef(): RelationshipStore | null {
  return store;
}

export function relationshipEngineRef(): RelationshipEngine | null {
  return engine;
}
