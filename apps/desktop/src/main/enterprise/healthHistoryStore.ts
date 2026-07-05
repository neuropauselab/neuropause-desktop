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

export interface HealthPoint {
  /** ISO date (YYYY-MM-DD) the point represents. */
  day: string;
  overall: number;
  engineering: number;
}

interface HealthFile {
  points: HealthPoint[];
}

const MAX_POINTS = 90; // ~3 months of daily history is plenty for weekly/monthly trends

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class HealthHistoryStore {
  private points: HealthPoint[] = [];
  private loaded = false;

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

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const file: HealthFile = { points: this.points };
    await fs.mkdir(dirname(this.filePath), { recursive: true }).catch(() => {});
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /** All recorded points, oldest first. */
  all(): HealthPoint[] {
    this.load();
    return [...this.points];
  }

  /**
   * Record today's datapoint. At most one point per calendar day (overwrites the
   * same day), bounded to MAX_POINTS. Pure aside from the file write; `nowMs`
   * injectable for tests.
   */
  async record(overall: number, engineering: number, nowMs: number = Date.now()): Promise<void> {
    this.load();
    const day = dayKey(nowMs);
    const existingIdx = this.points.findIndex((p) => p.day === day);
    const point: HealthPoint = { day, overall, engineering };
    if (existingIdx >= 0) this.points[existingIdx] = point;
    else this.points.push(point);
    this.points.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    if (this.points.length > MAX_POINTS) this.points = this.points.slice(-MAX_POINTS);
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
    if (this.points.length === 0) return null;
    const today = dayKey(nowMs);
    const older = this.points.filter((p) => p.day !== today);
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
    if (this.points.length === 0) return null;
    const cutoff = nowMs - days * 86_400_000;
    const inWindow = this.points.filter((p) => new Date(p.day).getTime() >= cutoff);
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
