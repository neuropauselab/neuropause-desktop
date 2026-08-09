/**
 * RoutingUsageStore — MEASURED counts of where AI work actually ran.
 *
 * Incremented once per completed AiEngine run, with the location taken from the
 * execution's own routing metadata. This store is the only source the AI Usage
 * surface reads; the surface shows an explicit "no data yet" state until the
 * first real measurement lands, and a percentage can therefore never appear
 * that was not computed from these counters.
 *
 * Contents are counts and timestamps only — no prompts, no responses, no
 * document content, nothing user-authored. Persisted with the same envelope +
 * atomic-write discipline as every other store.
 */
import { promises as fs } from 'node:fs';
import type { AiRoutingUsage, ProcessingLocation } from '@neuropause/shared';
import { emptyRoutingUsage } from '@neuropause/shared';
import { envelopeStamp, readStoreFile } from '../storage/storeEnvelope';

interface UsageFile extends AiRoutingUsage {
  schemaVersion?: number;
}

export class RoutingUsageStore {
  private usage: AiRoutingUsage = emptyRoutingUsage();
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  constructor(
    private readonly filePath: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const result = await readStoreFile<Partial<UsageFile>>(this.filePath);
    if (result.state === 'loaded' && result.data) {
      const raw = result.data;
      const base = emptyRoutingUsage();
      this.usage = {
        total: numberOr(raw.total, 0),
        byLocation: {
          local: numberOr(raw.byLocation?.local, 0),
          private_infrastructure: numberOr(raw.byLocation?.private_infrastructure, 0),
          external: numberOr(raw.byLocation?.external, 0),
          none: numberOr(raw.byLocation?.none, 0),
        },
        firstAt: typeof raw.firstAt === 'string' ? raw.firstAt : base.firstAt,
        lastAt: typeof raw.lastAt === 'string' ? raw.lastAt : base.lastAt,
      };
      // A tampered or corrupted file must not yield percentages that do not
      // add up: if the parts disagree with the total, the parts win.
      const sum =
        this.usage.byLocation.local +
        this.usage.byLocation.private_infrastructure +
        this.usage.byLocation.external +
        this.usage.byLocation.none;
      if (sum !== this.usage.total) this.usage = { ...this.usage, total: sum };
    }
    this.loaded = true;
  }

  record(location: ProcessingLocation): void {
    const at = this.now();
    this.usage = {
      total: this.usage.total + 1,
      byLocation: { ...this.usage.byLocation, [location]: this.usage.byLocation[location] + 1 },
      firstAt: this.usage.firstAt ?? at,
      lastAt: at,
    };
    this.schedulePersist();
  }

  snapshot(): AiRoutingUsage {
    return { ...this.usage, byLocation: { ...this.usage.byLocation } };
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        const file: UsageFile = { ...envelopeStamp(), ...this.usage };
        const tmp = `${this.filePath}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
        await fs.rename(tmp, this.filePath);
      }
    } catch {
      // A failed usage write must never disturb the AI run that triggered it.
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}
