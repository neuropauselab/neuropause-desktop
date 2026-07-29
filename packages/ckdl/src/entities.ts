/**
 * CKDL entity model (NCEA 11.1, Phase 1). Every enterprise entity participates in
 * ONE governed knowledge graph as a typed node. Crucially, a node is a governed
 * REFERENCE to an authoritative record living elsewhere (the workspace platform,
 * the runtime, a connector) — it carries a kind, an id, a label, and light
 * metadata, NOT a copy of the source record. This is how the layer holds one
 * graph over everything without duplicating knowledge.
 */
export const ENTITY_KINDS = [
  'organization',
  'person',
  'ai-employee',
  'project',
  'task',
  'document',
  'meeting',
  'connector',
  'workflow',
  'decision',
  'risk',
  'objective',
  'policy',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** A typed reference to an authoritative record — the unit of the graph. */
export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export interface EntityNode {
  /** Graph-local id: `${kind}:${sourceId}` — stable, so re-registration is idempotent. */
  key: string;
  kind: EntityKind;
  sourceId: string;
  label: string;
  /** Where the authoritative record lives (workspace / runtime / connector / …). */
  source: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export function entityKey(kind: EntityKind, sourceId: string): string {
  return `${kind}:${sourceId}`;
}

export function refKey(ref: EntityRef): string {
  return entityKey(ref.kind, ref.id);
}
