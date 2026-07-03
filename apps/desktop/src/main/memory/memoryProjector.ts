/**
 * The memory projector. Distills memory-worthy UDM entities into compact,
 * searchable memory items — pointers to real records, not copies. Each carries
 * `evidence` and `entityRefs` back to the UDM/graph so a recalled memory is
 * always traceable. Pure (no I/O), so it unit-tests from synthetic entities.
 *
 * Only memory-worthy kinds are projected: documents, tasks, conversations,
 * meetings (calendar events with attendees, and generic events), and projects
 * (as organizational context). Granular signals like individual messages and
 * raw contacts are intentionally not memorialized here.
 */
import type { MemoryItem, MemoryKind, UnifiedEntity } from '@neuropause/shared';

function toNum(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'unknown'
  );
}

function excerpt(s: string | null, n: number): string {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function memoryKindForEntity(e: UnifiedEntity): MemoryKind | null {
  switch (e.kind) {
    case 'document':
      return 'document';
    case 'task':
      return 'task';
    case 'conversation':
      return 'conversation';
    case 'calendar_event':
      return toNum(e.metadata.attendees) > 0 ? 'meeting' : null;
    case 'event':
      return 'meeting';
    case 'project':
      return 'context';
    default:
      return null;
  }
}

function buildContent(e: UnifiedEntity): string {
  const parts: string[] = [e.title];
  const body = excerpt(e.body, 280);
  if (body) parts.push(body);
  if (e.status) parts.push(`status: ${e.status}`);
  if (e.labels && e.labels.length > 0) parts.push(`labels: ${e.labels.join(', ')}`);
  return parts.join(' — ');
}

export function projectMemory(entities: UnifiedEntity[], now: string): MemoryItem[] {
  const out: MemoryItem[] = [];
  for (const e of entities) {
    const kind = memoryKindForEntity(e);
    if (!kind) continue;

    const entityRefs = [e.id];
    if (e.containerId) entityRefs.push(e.containerId);
    if (e.author) entityRefs.push(`person:${e.connectorId}:${slug(e.author)}`);

    out.push({
      id: `mem:${e.id}`,
      kind,
      origin: 'projected',
      title: e.title,
      content: buildContent(e),
      connectorId: e.connectorId,
      source: e.connectorId,
      entityRefs,
      tags: e.labels ?? [],
      occurredAt: e.timestamp ?? e.updatedAt,
      createdAt: now,
      updatedAt: now,
      evidence: { kind: e.kind, id: e.id },
      metadata: { kind: e.kind, status: e.status, url: e.url },
    });
  }
  return out;
}
