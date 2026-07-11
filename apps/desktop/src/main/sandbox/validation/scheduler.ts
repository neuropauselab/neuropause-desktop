/**
 * AI Sandbox — Continuous Validation Platform (S6): scheduler integration.
 *
 * REUSES the existing `taskScheduler` (the ONLY recurring scheduler) via an injected
 * {@link SchedulerPort} — it registers a single 1-minute tick and layers wall-clock cadence
 * matching on top (the same pattern the existing `DeliveryEngine` uses). No new scheduler,
 * no new timers. Manual/nightly/weekly/interval + pre-release/post-upgrade/regression/
 * certification triggers all resolve to a pipeline run through the existing executors.
 */
import { cadenceDue, cadenceLabel, type CadenceKind, type PipelineKind, type ScheduleCadence, type ScheduledValidation, type TriggerKind, type ValidationRun } from '@neuropause/shared';
import type { SchedulerPort } from './ports';

const TICK_ID = 'validation:scheduler-tick';
const TICK_MS = 60_000;

export interface SchedulerDeps {
  scheduler?: SchedulerPort;
  runPipeline: (pipeline: PipelineKind, trigger: TriggerKind) => Promise<ValidationRun>;
  now: () => number;
  /** Injected wall clock (tests pass a fixed date). */
  clock?: () => Date;
}

export class ValidationScheduler {
  private readonly schedules = new Map<string, ScheduledValidation>();
  private readonly lastRunDay = new Map<string, string>();
  private readonly intervalLastFire = new Map<string, number>();
  private started = false;
  private seq = 0;

  constructor(private readonly deps: SchedulerDeps) {}

  register(pipeline: PipelineKind, cadence: ScheduleCadence, trigger: TriggerKind = 'scheduled'): ScheduledValidation {
    this.seq += 1;
    const id = `sched-${pipeline}-${this.seq}`;
    const entry: ScheduledValidation = { id, pipeline, cadence, trigger, enabled: cadence.kind !== 'manual', lastRunAt: null, nextDueLabel: cadenceLabel(cadence) };
    this.schedules.set(id, entry);
    if (entry.enabled) this.ensureTick();
    return entry;
  }

  ensureTick(): void {
    if (this.started || !this.deps.scheduler) return;
    this.deps.scheduler.every(TICK_ID, TICK_MS, () => void this.tick());
    this.started = true;
  }

  /** Evaluate every schedule against the current wall clock and fire the due ones. */
  async tick(): Promise<void> {
    const d = this.deps.clock ? this.deps.clock() : new Date(this.deps.now());
    const minuteOfDay = d.getHours() * 60 + d.getMinutes();
    const dayOfWeek = d.getDay();
    const todayKey = d.toISOString().slice(0, 10);
    const nowMs = this.deps.now();

    for (const entry of this.schedules.values()) {
      if (!entry.enabled) continue;
      let due = false;
      if (entry.cadence.kind === 'interval') {
        const last = this.intervalLastFire.get(entry.id) ?? 0;
        due = nowMs - last >= (entry.cadence.everyMs ?? Infinity);
        if (due) this.intervalLastFire.set(entry.id, nowMs);
      } else {
        due = cadenceDue(entry.cadence, minuteOfDay, dayOfWeek, this.lastRunDay.get(entry.id) ?? '', todayKey);
        if (due) this.lastRunDay.set(entry.id, todayKey);
      }
      if (due) {
        entry.lastRunAt = d.toISOString();
        await this.deps.runPipeline(entry.pipeline, entry.trigger).catch(() => undefined);
      }
    }
  }

  list(): ScheduledValidation[] {
    return [...this.schedules.values()];
  }
  setEnabled(id: string, enabled: boolean): boolean {
    const e = this.schedules.get(id);
    if (!e) return false;
    e.enabled = enabled;
    if (enabled) this.ensureTick();
    return true;
  }
  cancel(id: string): boolean {
    return this.schedules.delete(id);
  }
  stop(): void {
    if (this.started) this.deps.scheduler?.cancel(TICK_ID);
    this.started = false;
  }
}

/** The default schedule set (Step 2): nightly regression, weekly certification. */
export function defaultSchedules(): { pipeline: PipelineKind; cadence: ScheduleCadence; trigger: TriggerKind }[] {
  return [
    { pipeline: 'regression', cadence: { kind: 'nightly', atMinutes: 120 } as ScheduleCadence, trigger: 'nightly' },
    { pipeline: 'certification', cadence: { kind: 'weekly', dayOfWeek: 1, atMinutes: 180 } as ScheduleCadence, trigger: 'weekly' },
  ];
}

export type { CadenceKind };
