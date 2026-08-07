/**
 * The feedback store: persists user-submitted feedback locally (atomic JSON,
 * newest-first) and offers an export for support conversations. Deliberately
 * export-based with no remote ingestion — the same posture as crash reporting and
 * telemetry. File path, clock, and id generation are injected, so the store is
 * unit-testable without Electron.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { FeedbackCategory, FeedbackEntry, FeedbackExport } from '@neuropause/shared';
import { readStoreFile } from '../storage/storeEnvelope';

interface FeedbackFileData {
  version: 1;
  entries: FeedbackEntry[];
}

export interface FeedbackSubmitInput {
  category: FeedbackCategory;
  message: string;
  appVersion?: string | null;
  context?: string | null;
}

export interface FeedbackStore {
  load(): Promise<void>;
  submit(input: FeedbackSubmitInput): Promise<FeedbackEntry>;
  /** Entries newest-first. */
  list(): FeedbackEntry[];
  exportAll(): FeedbackExport;
  /** Remove all entries (support/QA); returns the removed count. */
  clear(): Promise<number>;
}

export function createFeedbackStore(opts: {
  filePath: string;
  now?: () => Date;
  id?: () => string;
}): FeedbackStore {
  const now = opts.now ?? ((): Date => new Date());
  const makeId = opts.id ?? ((): string => randomUUID());
  let data: FeedbackFileData = { version: 1, entries: [] };
  let loaded = false;

  async function persist(): Promise<void> {
    const tmp = `${opts.filePath}.tmp`;
    await fs.mkdir(dirname(opts.filePath), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(tmp, opts.filePath);
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    // Phase 8 (8.3): envelope read — quarantine-not-reset on corrupt files.
    const result = await readStoreFile<Partial<FeedbackFileData>>(opts.filePath);
    data =
      result.state === 'loaded' && result.data
        ? { version: 1, entries: result.data.entries ?? [] }
        : { version: 1, entries: [] };
    loaded = true;
  }

  return {
    async load(): Promise<void> {
      await ensureLoaded();
    },

    async submit(input): Promise<FeedbackEntry> {
      await ensureLoaded();
      const message = input.message.trim();
      if (!message) throw new Error('Feedback message is required.');
      const entry: FeedbackEntry = {
        id: makeId(),
        category: input.category,
        message,
        createdAt: now().toISOString(),
        appVersion: input.appVersion ?? null,
        context: input.context ?? null,
      };
      data.entries.unshift(entry);
      await persist();
      return entry;
    },

    list(): FeedbackEntry[] {
      return [...data.entries];
    },

    exportAll(): FeedbackExport {
      return { exportedAt: now().toISOString(), entries: [...data.entries] };
    },

    async clear(): Promise<number> {
      await ensureLoaded();
      const removed = data.entries.length;
      data.entries = [];
      await persist();
      return removed;
    },
  };
}
