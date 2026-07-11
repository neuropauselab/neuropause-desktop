/**
 * AI Sandbox — AI QA Agent (S4): memory integration.
 *
 * REUSES the existing memory store — never a new one. Learnings (regressions, recoveries,
 * known issues) are written with `remember({ kind:'note', tags:['qa', …] })` and recalled
 * with `recall({ tag:'qa' })` — the established explicit-memory convention. The store is
 * injected as closures so the framework stays decoupled and testable.
 */
import type { QaAgentCategory } from '@neuropause/shared';
import type { QaMemory, QaMemoryEntry } from './ports';

export interface MemoryBackend {
  remember: (input: { kind: string; title: string; content: string; tags: string[]; entityRefs?: string[]; metadata?: Record<string, string | number | boolean | null> }) => { id: string };
  recall: (q: { text?: string; tag?: string; kinds?: string[]; limit?: number }) => { hits: { item: { id: string; title: string; content: string } }[] };
}

/** Production memory — writes explicit `note` items tagged `qa`; recalls by the `qa` tag. */
export class RealQaMemory implements QaMemory {
  readonly kind = 'memory-store';
  constructor(private readonly backend: MemoryBackend) {}

  recallKnownIssues(agent: QaAgentCategory, targets: string[]): Promise<string[]> {
    try {
      const res = this.backend.recall({ tag: 'qa', text: `${agent} ${targets.join(' ')}`.trim(), limit: 25 });
      return Promise.resolve(res.hits.map((h) => h.item.title));
    } catch {
      return Promise.resolve([]);
    }
  }

  store(entry: QaMemoryEntry): Promise<string | null> {
    try {
      const item = this.backend.remember({
        kind: 'note',
        title: entry.title,
        content: entry.content,
        tags: dedupe(['qa', ...entry.tags]),
        entityRefs: entry.entityRefs,
        metadata: entry.metadata,
      });
      return Promise.resolve(item?.id ?? null);
    } catch {
      return Promise.resolve(null);
    }
  }
}

/** Test double — records writes in memory, returns a fixed set of known issues. */
export class FakeQaMemory implements QaMemory {
  readonly kind = 'fake';
  readonly stored: QaMemoryEntry[] = [];
  constructor(private readonly known: string[] = []) {}
  recallKnownIssues(): Promise<string[]> {
    return Promise.resolve([...this.known]);
  }
  store(entry: QaMemoryEntry): Promise<string | null> {
    this.stored.push(entry);
    return Promise.resolve(`mem-fake-${this.stored.length}`);
  }
}

function dedupe(a: string[]): string[] {
  return [...new Set(a)];
}
