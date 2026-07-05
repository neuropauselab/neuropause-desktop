import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HealthHistoryStore } from './healthHistoryStore';

const DAY = 86_400_000;

describe('HealthHistoryStore', () => {
  let dir: string;
  let store: HealthHistoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'np-health-'));
    store = new HealthHistoryStore(join(dir, 'health-history.json'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('records a datapoint and reads it back', async () => {
    const now = Date.UTC(2026, 0, 10);
    await store.record(80, 90, now);
    const all = store.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ overall: 80, engineering: 90 });
  });

  it('keeps at most one point per calendar day (last write wins)', async () => {
    const now = Date.UTC(2026, 0, 10, 9);
    await store.record(70, 80, now);
    await store.record(75, 85, now + 3 * 3_600_000); // same day, later
    const all = store.all();
    expect(all).toHaveLength(1);
    expect(all[0].overall).toBe(75);
  });

  it('valueAround(7) returns null with no history, and null with only today', async () => {
    const now = Date.UTC(2026, 0, 10);
    expect(store.valueAround(7, now)).toBeNull();
    await store.record(60, 60, now);
    // only today's point exists → no meaningful trend
    expect(store.valueAround(7, now)).toBeNull();
  });

  it('valueAround(7) finds the point closest to 7 days ago', async () => {
    const now = Date.UTC(2026, 0, 15);
    await store.record(50, 50, now - 7 * DAY); // exactly a week ago
    await store.record(55, 55, now - 3 * DAY);
    await store.record(60, 60, now); // today
    const wk = store.valueAround(7, now);
    expect(wk).not.toBeNull();
    expect(wk!.overall).toBe(50);
  });

  it('persists across store instances (same file)', async () => {
    const now = Date.UTC(2026, 0, 10);
    await store.record(65, 70, now);
    const reopened = new HealthHistoryStore(join(dir, 'health-history.json'));
    expect(reopened.all()).toHaveLength(1);
    expect(reopened.all()[0].engineering).toBe(70);
  });

  it('bounds history to 90 points', async () => {
    const base = Date.UTC(2025, 0, 1);
    for (let i = 0; i < 100; i++) {
      await store.record(50 + (i % 10), 50, base + i * DAY);
    }
    expect(store.all().length).toBeLessThanOrEqual(90);
  });
});
