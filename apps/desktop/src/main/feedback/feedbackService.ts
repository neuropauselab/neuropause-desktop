/**
 * The feedback store: persists user-submitted feedback locally (atomic JSON,
 * newest-first) and offers an export for support conversations. Deliberately
 * export-based with no remote ingestion — the same posture as crash reporting and
 * telemetry. File path, clock, and id generation are injected, so the store is
 * unit-testable without Electron.
 *
 * P13C ROUND 3 — found by the sweep. THIS FILE HAD NO TENANT DIMENSION AT ALL.
 *
 * `list()` and `exportAll()` returned `[...data.entries]` — every entry from
 * every organization, each carrying a free-text `message` and a `context` blob
 * naming the view the user was on. All five channels sat on the PUBLIC
 * allowlist: no `requireAuth`, no permission. So any renderer message read every
 * tenant's feedback, `feedback:exportToFile` wrote the whole set as JSON to any
 * path the save dialog accepted — OUTSIDE userData, which makes it egress — and
 * `feedback:clear` destroyed every tenant's entries.
 *
 * Entries now carry an owner, reads filter, and `clear` removes only the
 * caller's. The channels move off the public allowlist in `feedback/index.ts`.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { FeedbackCategory, FeedbackEntry, FeedbackExport } from '@neuropause/shared';
import { readStoreFile } from '../storage/storeEnvelope';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../tenancy/tenantOwnedStore';

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
  /** Bind the tenant boundary. UNBOUND DENIES. */
  bindScope(source: () => TenantScope | null): FeedbackStore;
  hasScope(): boolean;
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
  const tenancy = new TenantOwnership('user-feedback');
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

  const store: FeedbackStore = {
    async load(): Promise<void> {
      await ensureLoaded();
    },

    bindScope(source): FeedbackStore {
      tenancy.bindScope(source);
      return store;
    },
    hasScope(): boolean {
      return tenancy.hasScope();
    },

    async submit(input): Promise<FeedbackEntry> {
      await ensureLoaded();
      const message = input.message.trim();
      if (!message) throw new Error('Feedback message is required.');
      const entry: FeedbackEntry = {
        id: makeId(),
        tenantId: tenancy.requireTenant(),
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

    /** The CALLER'S entries. Was every organization's, over a public channel. */
    list(): FeedbackEntry[] {
      return tenancy.onlyMine(data.entries);
    },

    /**
     * The CALLER'S entries, as an export.
     *
     * This one matters most: `feedback:exportToFile` writes the result to a
     * user-chosen path, which is the only place in this subsystem where data
     * leaves userData.
     */
    exportAll(): FeedbackExport {
      return { exportedAt: now().toISOString(), entries: tenancy.onlyMine(data.entries) };
    },

    /** Remove the CALLER'S entries. Was every organization's. */
    async clear(): Promise<number> {
      await ensureLoaded();
      const mine = new Set(tenancy.onlyMine(data.entries).map((e) => e.id));
      if (mine.size === 0) return 0;
      data.entries = data.entries.filter((e) => !mine.has(e.id));
      await persist();
      return mine.size;
    },
  };
  return store;
}
