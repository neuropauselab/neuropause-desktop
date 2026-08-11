/**
 * Health History Store (V3.0).
 *
 * Persists a daily org-health datapoint (overall + engineering) so the Executive
 * Center's Weekly Trends can answer "is the organization better or worse than last
 * week?". Mirrors the existing JSON-store pattern (injected path, atomic write,
 * 0o600) and is Electron-free by construction, so it unit-tests without a runtime.
 *
 * It records at most one datapoint per calendar day (last write wins for the day),
 * keeps a bounded window, and exposes `valueAround(daysAgo)` to fetch the closest
 * historical point — which the Executive Center subsystem wires to `previousWeek`.
 */
import { promises as fs, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../tenancy/tenantOwnedStore';

export interface HealthPoint {
  /** ISO date (YYYY-MM-DD) the point represents. */
  day: string;
  overall: number;
  engineering: number;
  /**
   * P13C ROUND 5 — the organization this datapoint describes.
   *
   * Optional because rows written before this round have no owner. They are
   * NOT attributed to anybody: a pre-Round-5 file holds one series for the
   * install and there is no evidence in it of which tenant wrote which day.
   */
  tenantId?: string | null;
}

interface HealthFile {
  points: HealthPoint[];
}

const MAX_POINTS = 90; // ~3 months of daily history is plenty for weekly/monthly trends

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class HealthHistoryStore {
  /**
   * P13C ROUND 5 — TENANT-SCOPED, and it looked global right up until you ask
   * what the numbers ARE.
   *
   * `HealthPoint` is `{ day, overall, engineering }` — three primitives, no ids,
   * no text. That shape is why five sweeps read it as install telemetry. But
   * `overall` comes from `collectOrgHealthInputs`, which is a function of ONE
   * organization's headcount, licence runway, connector fleet and activity
   * volume — every input of which was deliberately scoped in an earlier round.
   *
   * And the mechanism is worse than a read leak. The primary key was the
   * CALENDAR DAY, one row per day for the whole install, last-write-wins — so
   * whichever tenant opened the Executive Center last that day DESTROYED the
   * other tenant's datapoint, and six subsystems (Insight predictions, Strategy,
   * Analytics, Operations, the digital twin, the Executive Center itself) then
   * drew trend lines and forecasts from whoever happened to write last.
   */
  private readonly tenancy = new TenantOwnership('enterprise-health-history');

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  /** Unscoped ownership counts, for the migration inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.tenancy.countOwnership(this.points);
  }

  private points: HealthPoint[] = [];
  private loaded = false;
  /** Serializes persists so concurrent record() calls can't race the temp file. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<HealthFile>;
      this.points = Array.isArray(parsed.points) ? parsed.points : [];
    } catch {
      this.points = [];
    }
  }

  private persist(): Promise<void> {
    // Chain writes so two same-tick records serialize instead of colliding on a
    // shared temp path (which previously caused ENOENT on rename). The stored
    // chain is always caught so one failure can't wedge later writes; the real
    // result still propagates to the caller.
    const run = this.writeChain.then(() => this.writeNow());
    this.writeChain = run.catch(() => {});
    return run;
  }

  private async writeNow(): Promise<void> {
    const file: HealthFile = { points: this.points };
    // Unique temp per write so even overlapping writers never share a temp file.
    const tmp = `${this.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.mkdir(dirname(this.filePath), { recursive: true }).catch(() => {});
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /** All recorded points, oldest first. */
  /** The CALLER'S points, oldest first. Was every organization's series. */
  all(): HealthPoint[] {
    this.load();
    return this.tenancy.onlyMine(this.points);
  }

  /**
   * Record today's datapoint. At most one point per calendar day (overwrites the
   * same day), bounded to MAX_POINTS. Pure aside from the file write; `nowMs`
   * injectable for tests.
   */
  async record(overall: number, engineering: number, nowMs: number = Date.now()): Promise<void> {
    // A datapoint with no owner is a datapoint nobody can read back. Refuse it
    // rather than write one, matching every other write in this program.
    const tenantId = this.tenancy.requireTenant();
    this.load();
    const day = dayKey(nowMs);
    /**
     * KEYED BY (TENANT, DAY), not by day.
     *
     * One row per calendar day for the whole install meant last-write-wins
     * across tenants: whoever opened the Executive Center last that day
     * overwrote everybody else's datapoint. Not a leak — a silent destruction
     * of another organization's history, which then fed six subsystems'
     * trend lines and forecasts.
     */
    const existingIdx = this.points.findIndex((p) => p.day === day && p.tenantId === tenantId);
    const point: HealthPoint = { tenantId, day, overall, engineering };
    if (existingIdx >= 0) this.points[existingIdx] = point;
    else this.points.push(point);
    this.points.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    // Retention PER TENANT. Install-wide, a busy tenant's daily writes pushed
    // another tenant's ninety-day window out from underneath it.
    this.points = this.tenancy.pruneOwn(this.points, MAX_POINTS, (a, b) => a.day.localeCompare(b.day));
    await this.persist();
  }

  /**
   * The datapoint closest to `daysAgo` days before `nowMs`, or null if there is no
   * history old enough. Used for the weekly (7d) comparison. Chooses the point with
   * the smallest absolute day-distance to the target, requiring at least one point
   * strictly older than today so a trend is meaningful.
   */
  valueAround(daysAgo: number, nowMs: number = Date.now()): HealthPoint | null {
    this.load();
    const mine = this.tenancy.onlyMine(this.points);
    if (mine.length === 0) return null;
    const today = dayKey(nowMs);
    const older = mine.filter((p) => p.day !== today);
    if (older.length === 0) return null;
    const targetMs = nowMs - daysAgo * 86_400_000;
    let best: HealthPoint | null = null;
    let bestDist = Infinity;
    for (const p of older) {
      const dist = Math.abs(new Date(p.day).getTime() - targetMs);
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    return best;
  }

  /**
   * Rich stats for a metric over the trailing `days` window (V3.1). Pure over the
   * already-loaded points — no extra persistence, no I/O. Returns null when there
   * are no points in the window. `metric` selects overall vs engineering.
   */
  windowStats(
    days: number,
    metric: 'overall' | 'engineering',
    nowMs: number = Date.now(),
  ): {
    values: number[];
    current: number;
    windowStart: number;
    movingAverage: number;
    highest: number;
    lowest: number;
    stddev: number;
    count: number;
  } | null {
    this.load();
    // The CALLER'S series. Unscoped, every trend line, moving average and
    // standard deviation in the Executive Center was computed across tenants.
    const mine = this.tenancy.onlyMine(this.points);
    if (mine.length === 0) return null;
    const cutoff = nowMs - days * 86_400_000;
    const inWindow = mine.filter((p) => new Date(p.day).getTime() >= cutoff);
    if (inWindow.length === 0) return null;
    const values = inWindow.map((p) => p[metric]);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    return {
      values,
      current: values[values.length - 1],
      windowStart: values[0],
      movingAverage: Math.round(mean),
      highest: Math.max(...values),
      lowest: Math.min(...values),
      stddev: Math.sqrt(variance),
      count: values.length,
    };
  }
}
