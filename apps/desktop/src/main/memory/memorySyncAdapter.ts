/**
 * Memory sync adapter (V6.6.2) — the translation layer between the local
 * `MemoryItem` and the `MemoryState` the tested `resolveMemorySync` engine
 * consumes. Pure and side-effect-free: serialization, version-payload extraction,
 * and reconstruction only. NO merge logic lives here — conflict resolution is
 * `resolveMemorySync`'s job and its alone.
 *
 * The version payload maps a memory's syncable fields onto a `MemoryVersion`'s
 * `text` + `metadata`: `text` is the memory's content (what gets embedded), and
 * `metadata` carries the remaining user-authored fields (title, kind, tags,
 * entityRefs, occurredAt, and the item's own metadata). Local-only fields — id,
 * createdAt, origin, evidence, connectorId, source — are NOT versioned; they're
 * device/provenance state, not shared content.
 */
import type {
  MemoryItem,
  MemoryKind,
  MemoryMeta,
  MemoryState,
  MemoryVersion,
} from '@neuropause/shared';

/** The syncable content of a memory, shaped for a MemoryVersion (text + metadata). */
export function memoryVersionPayload(item: MemoryItem): {
  text: string;
  metadata: Record<string, unknown>;
} {
  return {
    text: item.content,
    metadata: {
      title: item.title,
      kind: item.kind,
      tags: item.tags,
      entityRefs: item.entityRefs,
      occurredAt: item.occurredAt,
      meta: item.metadata,
    },
  };
}

/**
 * Reconstruct the syncable MemoryItem fields from a version's payload — the
 * inverse of memoryVersionPayload. Returns a partial patch to apply onto an item
 * when a remote/merged version becomes the head. Local-only fields are untouched.
 */
export function memoryFieldsFromVersion(version: MemoryVersion): {
  content: string;
  title: string;
  kind: MemoryKind;
  tags: string[];
  entityRefs: string[];
  occurredAt: string | null;
  metadata: MemoryMeta;
} {
  const m = (version.metadata ?? {}) as Record<string, unknown>;
  return {
    content: version.text,
    title: typeof m.title === 'string' ? m.title : '',
    kind: (typeof m.kind === 'string' ? m.kind : 'note') as MemoryKind,
    tags: Array.isArray(m.tags) ? (m.tags as string[]) : [],
    entityRefs: Array.isArray(m.entityRefs) ? (m.entityRefs as string[]) : [],
    occurredAt: typeof m.occurredAt === 'string' ? m.occurredAt : null,
    metadata: (m.meta ?? {}) as MemoryMeta,
  };
}

/**
 * Build the MemoryState for `resolveMemorySync` from an item's sync fields.
 * Returns null for a local-only item (no `sync`) — nothing to reconcile. The head
 * is located in the append-only history by the recorded `versionId`.
 */
export function toSyncState(item: MemoryItem): MemoryState | null {
  if (!item.sync) return null;
  const head = item.sync.history.find((v) => v.versionId === item.sync!.versionId);
  if (!head) return null;
  return {
    memoryId: item.id,
    orgId: item.sync.orgId,
    head,
    history: item.sync.history,
    // P13A — the owner travels with the state so the receiving device can
    // authorize the write instead of inferring an owner from whichever
    // organization happens to be active over there.
    ...(item.owner ? { owner: item.owner } : {}),
  };
}
