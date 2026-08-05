/**
 * Executive Intelligence Delivery Engine.
 *
 * A single reusable orchestrator that every AI module registers scheduled
 * "intelligence sources" with. When a source's cadence fires, the engine asks it
 * to produce items, ranks/filters them (priority + impact + DND + working hours),
 * and delivers survivors through available channels.
 *
 * Reuses:
 *   - taskScheduler.every()       (the ONLY recurring scheduler — not duplicated)
 *   - notificationScheduler       (the ONLY desktop-notification path — via the desktop channel)
 * Introduces no second scheduler and no second notification system.
 */
import { meetsPriority, scoreImpact } from '@neuropause/shared';
import type {
  DeliveryChannel,
  DeliveryPreferences,
  IntelligenceItem,
  IntelligenceSource,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { taskScheduler } from './taskScheduler';

const log = createLogger('delivery-engine');

/** Local-time minutes-past-midnight for a Date, honoring an optional fixed offset. */
function localMinutes(now: Date, offsetMinutes: number | null): number {
  if (offsetMinutes == null) return now.getHours() * 60 + now.getMinutes();
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  const d = new Date(utc + offsetMinutes * 60_000);
  return d.getHours() * 60 + d.getMinutes();
}

function localDayOfWeek(now: Date, offsetMinutes: number | null): number {
  if (offsetMinutes == null) return now.getDay();
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  return new Date(utc + offsetMinutes * 60_000).getDay();
}

function localDayOfMonth(now: Date, offsetMinutes: number | null): number {
  if (offsetMinutes == null) return now.getDate();
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  return new Date(utc + offsetMinutes * 60_000).getDate();
}

/**
 * Injectable dependencies keep the engine unit-testable (clock + scheduler +
 * channels can all be faked), matching the codebase's factory/DI convention.
 */
export interface DeliveryEngineDeps {
  now: () => Date;
  scheduler: Pick<typeof taskScheduler, 'every' | 'cancel'>;
  channels: DeliveryChannel[];
  getPreferences: () => DeliveryPreferences;
}

export class DeliveryEngine {
  readonly name = 'executive-delivery-engine';
  private sources = new Map<string, IntelligenceSource>();
  private started = false;
  /** How often we wake to check cadences (1 min). The tick is cheap and idempotent. */
  private readonly tickMs = 60_000;

  constructor(private readonly deps: DeliveryEngineDeps) {}

  /** Register (or replace) an intelligence source. Idempotent by key. */
  register(source: IntelligenceSource): void {
    this.sources.set(source.key, source);
    log.info('Registered intelligence source', { key: source.key });
  }

  unregister(key: string): void {
    this.sources.delete(key);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.deps.scheduler.every('delivery-engine:tick', this.tickMs, () => {
      void this.tick();
    });
    log.info('Delivery engine started');
  }

  stop(): void {
    this.deps.scheduler.cancel('delivery-engine:tick');
    this.started = false;
  }

  /** Tracks the last local-minute we fired a given source, to avoid double-fire within a minute. */
  private lastFiredKeyMinute = new Map<string, string>();

  /** One scheduler tick: fire any source whose cadence matches the current minute. */
  async tick(): Promise<void> {
    const prefs = this.deps.getPreferences();
    if (!prefs.enabled) return;
    const now = this.deps.now();
    for (const source of this.sources.values()) {
      // Phase 6 Stage 5 — per-source mute (user preference; additive).
      if (prefs.mutedSources?.includes(source.key)) continue;
      if (this.cadenceMatches(source, now, prefs)) {
        const stamp = `${source.key}@${this.minuteStamp(now)}`;
        if (this.lastFiredKeyMinute.get(source.key) === stamp) continue; // already fired this minute
        this.lastFiredKeyMinute.set(source.key, stamp);
        await this.fireSource(source, prefs);
      }
    }
  }

  private minuteStamp(now: Date): string {
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  }

  private cadenceMatches(
    source: IntelligenceSource,
    now: Date,
    prefs: DeliveryPreferences,
  ): boolean {
    const off = prefs.timezoneOffsetMinutes;
    const c = source.cadence;
    switch (c.kind) {
      case 'daily':
        return localMinutes(now, off) === c.atMinutes;
      case 'weekly':
        return localDayOfWeek(now, off) === c.dayOfWeek && localMinutes(now, off) === c.atMinutes;
      case 'monthly':
        return localDayOfMonth(now, off) === c.dayOfMonth && localMinutes(now, off) === c.atMinutes;
      case 'interval':
        // interval sources fire on a wall-clock modulus of the tick
        return (
          Math.floor(now.getTime() / this.tickMs) %
            Math.max(1, Math.round(c.everyMs / this.tickMs)) ===
          0
        );
      default:
        return false;
    }
  }

  /** Produce → filter → deliver. Public so an IPC "send me my brief now" can reuse it. */
  async fireSource(
    source: IntelligenceSource,
    prefs: DeliveryPreferences,
  ): Promise<IntelligenceItem[]> {
    let items: IntelligenceItem[] | null;
    try {
      items = await source.produce();
    } catch (err) {
      log.warn('Source produce() failed', { key: source.key, err });
      return [];
    }
    if (!items || items.length === 0) return []; // silent no-op when nothing worth saying
    const delivered = items.filter((it) => this.shouldDeliver(it, prefs));
    // Highest-impact first so the most important notification surfaces last-in/most-recent.
    delivered.sort((a, b) => scoreImpact(a.impact) - scoreImpact(b.impact));
    // Phase 6 Stage 5 — stamp the source key so channels (e.g. the Notification
    // Inbox) know which source an item was delivered under.
    for (const it of delivered) await this.deliver({ ...it, sourceKey: source.key });
    log.info('Source fired', {
      key: source.key,
      produced: items.length,
      delivered: delivered.length,
    });
    return delivered;
  }

  /**
   * STEP 5 gate: priority threshold + DND. Critical always gets through, even
   * under DND. A scheduled brief fires at the time the user explicitly chose, so
   * it is not additionally gated by working hours — the schedule *is* the intent.
   */
  private shouldDeliver(item: IntelligenceItem, prefs: DeliveryPreferences): boolean {
    if (!meetsPriority(item.priority, prefs.minPriority)) return false;
    if (item.priority === 'critical') return true; // critical always gets through
    if (prefs.doNotDisturb) return false;
    return true;
  }

  private async deliver(item: IntelligenceItem): Promise<void> {
    for (const ch of this.deps.channels) {
      if (!ch.available) continue;
      try {
        await ch.deliver(item);
      } catch (err) {
        log.warn('Channel delivery failed', { channel: ch.key, err });
      }
    }
  }

  /** For tests/inspection. */
  listSources(): string[] {
    return [...this.sources.keys()];
  }

  /**
   * Phase 6 Stage 5 — deliver an EVENT-DRIVEN item immediately through the SAME
   * gates a scheduled item passes (enabled, per-source mute, priority threshold,
   * DND with critical bypass) and the same channels. Used by the notification
   * subsystem's bus-driven sources (approval-needed, workflow-complete,
   * connector-failed, meeting-soon, …). Returns true when it was delivered.
   */
  async deliverNow(sourceKey: string, item: IntelligenceItem): Promise<boolean> {
    const prefs = this.deps.getPreferences();
    if (!prefs.enabled) return false;
    if (prefs.mutedSources?.includes(sourceKey)) return false;
    if (!this.shouldDeliver(item, prefs)) return false;
    await this.deliver({ ...item, sourceKey });
    return true;
  }
}
