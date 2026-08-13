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
  /**
   * The organization a schedule belongs to. P13C ROUND 10, fresh red team — HIGH.
   *
   * REQUIRED, with no default. The schedule set was ONE install-wide Map with no
   * tenant dimension anywhere: any organization Owner or Manager could enable a
   * pipeline that "mutates real platform data", every other organization saw the
   * flag flip, and when the tick fired it ran under NO PRINCIPAL — so
   * `activeTenantScope` fell through to the SESSION and the pipeline executed
   * against whichever tenant happened to be signed in at 02:00.
   *
   * An optional resolver would default to a single unscoped set, which is the
   * defect. A composition root that cannot name an organization must not
   * register a schedule.
   */
  tenantId: () => string | null;
  /**
   * Run `fn` under an explicit principal for `tenantId`. P13C ROUND 10.
   *
   * `taskScheduler.every` grew a `principals` option in Round 10 and NO CALL SITE
   * PASSES IT — the port type below drops the parameter, so a caller could not
   * supply one even if it wanted to. Rather than widen that port and leave the
   * default fail-open, the schedule carries its owner and the tick runs each due
   * entry under that owner explicitly. Returns false when no principal can be
   * built, and a schedule that cannot name its principal DOES NOT RUN.
   */
  runAsOwner: (tenantId: string, fn: () => Promise<void>) => Promise<boolean>;
  runPipeline: (pipeline: PipelineKind, trigger: TriggerKind) => Promise<ValidationRun>;
  now: () => number;
  /** Injected wall clock (tests pass a fixed date). */
  clock?: () => Date;
}

export class ValidationScheduler {
  /**
   * The owner of each schedule id. P13C ROUND 10, fresh red team.
   *
   * Kept beside `schedules` rather than on `ScheduledValidation` because that
   * type is shared with the renderer and an owner field on the wire is a fact
   * about another tenant. `list()` and `setEnabled()` consult this first.
   */
  private readonly owners = new Map<string, string>();
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
    // P13C ROUND 10 — the owner is stamped from the resolver at registration.
    // An unresolved registrant produces a schedule owned by nobody, which no
    // caller can see and the tick will not run.
    const owner = this.deps.tenantId();
    this.schedules.set(id, entry);
    if (owner !== null && owner !== '') this.owners.set(id, owner);
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
        /**
         * P13C ROUND 10 — RUN AS THE OWNER, OR DO NOT RUN.
         *
         * This was a bare `await this.deps.runPipeline(...)` with no principal,
         * so a pipeline that mutates real platform data executed inside
         * whichever tenant was signed in when the tick fired.
         */
        const owner = this.owners.get(entry.id);
        if (owner === undefined) continue;
        const ran = await this.deps.runAsOwner(owner, async () => {
          await this.deps.runPipeline(entry.pipeline, entry.trigger).catch(() => undefined);
        });
        if (ran) entry.lastRunAt = d.toISOString();
      }
    }
  }

  /** THE CALLER'S OWN schedules. P13C ROUND 10 — was every tenant's. */
  list(): ScheduledValidation[] {
    const mine = this.deps.tenantId();
    if (mine === null || mine === '') return [];
    return [...this.schedules.values()].filter((e) => this.owners.get(e.id) === mine);
  }

  /** The schedule the caller owns, or null. Ownership, not identity. */
  private owned(id: string): ScheduledValidation | null {
    const mine = this.deps.tenantId();
    if (mine === null || mine === '') return null;
    if (this.owners.get(id) !== mine) return null;
    return this.schedules.get(id) ?? null;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    // P13C ROUND 10 — a renderer-supplied schedule id is an identifier. It was
    // resolved straight out of the shared Map, so one organization's Manager
    // toggled a pipeline every other organization could see and be run by.
    const e = this.owned(id);
    if (!e) return false;
    e.enabled = enabled;
    if (enabled) this.ensureTick();
    return true;
  }
  cancel(id: string): boolean {
    if (this.owned(id) === null) return false;
    this.owners.delete(id);
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
