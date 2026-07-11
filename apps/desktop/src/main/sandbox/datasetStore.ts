/**
 * AI Sandbox — Dataset store (S1). Datasets are named, workspace-scoped INPUT
 * fixtures (the counterpart to artifacts, which are execution outputs). S1 owns the
 * dataset record + optional `storageRef`; the bytes are a later stage's concern.
 * Electron-free.
 */
import { randomUUID } from 'node:crypto';
import type { Dataset } from '@neuropause/shared';
import { PersistentStore } from './persistentStore';

interface DatasetFile {
  datasets: Dataset[];
}

export interface DatasetCreateInput {
  workspaceId: string;
  name: string;
  description?: string;
  rows?: number;
  schema?: string[];
  storageRef?: string | null;
}

export class SandboxDatasetStore extends PersistentStore<DatasetFile> {
  private datasets = new Map<string, Dataset>();

  constructor(filePath: string, private readonly now: () => number = Date.now) {
    super(filePath);
  }

  protected snapshot(): DatasetFile {
    return { datasets: [...this.datasets.values()] };
  }
  protected hydrate(data: Partial<DatasetFile>): void {
    for (const d of data.datasets ?? []) if (d?.id) this.datasets.set(d.id, d);
  }

  create(input: DatasetCreateInput): Dataset {
    const iso = new Date(this.now()).toISOString();
    const dataset: Dataset = {
      id: `sbd_${randomUUID()}`,
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? '',
      rows: input.rows ?? 0,
      schema: input.schema ?? [],
      storageRef: input.storageRef ?? null,
      createdAt: iso,
      updatedAt: iso,
    };
    this.datasets.set(dataset.id, dataset);
    this.changed();
    return dataset;
  }

  get(id: string): Dataset | null {
    return this.datasets.get(id) ?? null;
  }
  list(workspaceId?: string): Dataset[] {
    return [...this.datasets.values()]
      .filter((d) => (workspaceId ? d.workspaceId === workspaceId : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
  delete(id: string): boolean {
    const ok = this.datasets.delete(id);
    if (ok) this.changed();
    return ok;
  }
}
