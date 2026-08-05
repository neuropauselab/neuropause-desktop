/**
 * Module 12 — Enterprise Files. Personal / team / organization files with versioning, tags, and a
 * real in-process search over file METADATA. Only metadata is held — real bytes live in an external
 * storage provider (adapter-verified until configured; public cloud storage is regulated-external).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';

export type FileScope = 'personal' | 'team' | 'organization';
export interface FileMeta {
  id: string;
  name: string;
  scope: FileScope;
  ownerId: string;
  version: number;
  sizeBytes: number;
  tags: string[];
  note: string;
  createdAt: number;
}

export class FileRuntime {
  private readonly files = new Map<string, FileMeta>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async register(input: { name: string; scope: FileScope; ownerId: string; sizeBytes?: number; tags?: string[] }): Promise<FileMeta> {
    const f: FileMeta = { id: randomId('file'), name: input.name, scope: input.scope, ownerId: input.ownerId, version: 1, sizeBytes: input.sizeBytes ?? 0, tags: input.tags ?? [], note: 'metadata only — real bytes live in an external storage provider (adapter-verified until configured)', createdAt: this.clock.now() };
    this.files.set(f.id, f);
    await this.governance.record({ actor: input.ownerId, module: 'files', operation: `register.${input.scope}`, targetId: f.id, evidence: 'live-verified' });
    return f;
  }
  newVersion(id: string): FileMeta {
    const f = this.require(id);
    f.version += 1;
    return f;
  }
  tag(id: string, tag: string): FileMeta {
    const f = this.require(id);
    if (!f.tags.includes(tag)) f.tags.push(tag);
    return f;
  }
  /** Real in-process search over file metadata (name + tags). */
  search(query: string): FileMeta[] {
    const q = query.toLowerCase();
    return [...this.files.values()].filter((f) => f.name.toLowerCase().includes(q) || f.tags.some((t) => t.toLowerCase().includes(q)));
  }

  private require(id: string): FileMeta {
    const f = this.files.get(id);
    if (!f) throw new Error(`no file ${id}`);
    return f;
  }

  list(scope?: FileScope): FileMeta[] {
    const all = [...this.files.values()];
    return scope ? all.filter((f) => f.scope === scope) : all;
  }
  count(): number { return this.files.size; }
}
