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
import { declareStoreScope } from '../tenancy/storeScope';

/**
 * P13C ROUND 9 — the third store the structural detector's `holdsState` regex
 * misses (`private usage: AiRoutingUsage = emptyRoutingUsage()` matches none of
 * its three patterns). Declared here rather than reported and left.
 *
 * SYSTEM authority, and that is the honest word: nothing mutates these counters
 * through a user-facing surface. `record()` is called by the engine once per
 * completed run; the only channel is the READ `ai:routing.usage`, which Round 8
 * moved off the public allowlist to `cloud:read` because on a two-tenant install
 * a rising total is the other tenant's activity volume. The counters themselves
 * are five integers and two timestamps — Round 8 inspected the persisted file and
 * recorded that finding; this declaration is that decision written where the
 * inventory can see it.
 */
declareStoreScope({
  name: 'ai-routing-usage',
  scope: 'INSTALL_GLOBAL',
  persistence: 'file',
  authority: 'SYSTEM',
  classification: 'INSTALL_METADATA',
  retention:
    'No cap and no deletion path: counters only increment, and nothing removes rows, so a ' +
    'retention pass cannot reach another tenant’s data because there are no rows to reach.',
  reason:
    'WHY GLOBAL: one shared AI engine on one machine; the counters describe WHERE that engine ' +
    'ran work (local / private infrastructure / external), which is a property of the install’s ' +
    'configuration. WHAT DATA: five integers and two timestamps — no prompts, responses, record ' +
    'content or identifiers. CROSS-TENANT COST: aggregate volume and timing are still an ' +
    'inference channel, which is why the read requires cloud:read rather than being public.',
});

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
