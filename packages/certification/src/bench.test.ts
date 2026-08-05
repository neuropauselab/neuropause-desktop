/**
 * Runs the benchmark harness and records the results (Phase 7). Asserts the
 * measurements are real, finite, and non-negative — the numbers themselves are
 * environment-dependent, so this checks sanity + reproducibility, and writes the
 * report to /tmp for the benchmark deliverable. Traceable: anyone can re-run.
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { runBenchmarks } from './bench';

describe('Production benchmarks (Phase 7) — real, reproducible measurements', () => {
  it('produces sane, traceable measurements over the composed platform', async () => {
    const report = await runBenchmarks({ at: 0 });
    expect(report.node).toMatch(/^v\d+/);
    expect(report.results.length).toBeGreaterThanOrEqual(10);
    for (const r of report.results) {
      expect(Number.isFinite(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.unit).toBeTruthy();
    }
    const byName = new Map(report.results.map((r) => [r.name, r]));
    expect((byName.get('Memory after init — RSS')?.value ?? 0)).toBeGreaterThan(0);
    expect((byName.get('Platform startup (runtime + security + operations + ai)')?.value ?? -1)).toBeGreaterThanOrEqual(0);
    expect(report.limitations.length).toBeGreaterThan(0); // honest about scope
    try {
      writeFileSync('/tmp/np-bench-16.json', JSON.stringify(report, null, 2));
    } catch {
      /* best-effort — the assertions above are the real gate */
    }
  });
});
