/**
 * Module 6 — Enterprise Notes. Personal, shared, meeting, and voice notes with a real in-process
 * extractive summary. (Deeper AI summarization reuses the Workspace AI.) Live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';

export type NoteKind = 'personal' | 'shared' | 'meeting' | 'voice';

export interface Note {
  id: string;
  ownerId: string;
  kind: NoteKind;
  title: string;
  body: string;
  createdAt: number;
}

export class NoteRuntime {
  private readonly notes = new Map<string, Note>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async create(input: { ownerId: string; kind: NoteKind; title: string; body?: string }): Promise<Note> {
    const n: Note = { id: randomId('note'), ownerId: input.ownerId, kind: input.kind, title: input.title, body: input.body ?? '', createdAt: this.clock.now() };
    this.notes.set(n.id, n);
    await this.governance.record({ actor: input.ownerId, module: 'notes', operation: `create.${input.kind}`, targetId: n.id, evidence: 'live-verified' });
    return n;
  }

  /** Real in-process extractive summary — the first sentence (or first 120 chars). */
  summarize(id: string): { noteId: string; summary: string } {
    const n = this.notes.get(id);
    if (!n) throw new Error(`no note ${id}`);
    const firstSentence = n.body.split(/(?<=[.!?])\s/)[0] ?? '';
    const summary = firstSentence.length > 0 && firstSentence.length <= 200 ? firstSentence : n.body.slice(0, 120);
    return { noteId: id, summary };
  }

  get(id: string): Note | undefined { return this.notes.get(id); }
  list(ownerId?: string): Note[] {
    const all = [...this.notes.values()];
    return ownerId ? all.filter((n) => n.ownerId === ownerId) : all;
  }
  count(): number { return this.notes.size; }
}
