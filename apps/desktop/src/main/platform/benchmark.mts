/**
 * Platform-core micro-benchmarks. Run with:
 *
 *   node --experimental-strip-types src/main/platform/benchmark.mts
 *
 * (from apps/desktop). Measures Event Bus publish/fan-out throughput, error-
 * isolation overhead, and Timeline append/flush/query latency against the real,
 * Electron-free implementations. Figures vary with hardware; the Diagnostics
 * Center shows the equivalent live metrics (avgDispatchMs, eventsPerMinute).
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { EventBus } from './eventBus.ts';
import { TimelineService } from './timelineService.ts';

type Input = Parameters<EventBus['publish']>[0];
const mk = (i: number): Input => ({
  type: 'runtime.health_changed',
  category: 'runtime',
  source: 'bench',
  resource: { type: 'app', id: 'app' + (i % 50), name: null },
  metadata: { i, ok: true, note: 'benchmark event' },
});
const ms = (start: bigint): number => Number(process.hrtime.bigint() - start) / 1e6;
const rate = (ops: number, t: number): string => `${Math.round(ops / (t / 1000)).toLocaleString()} ops/s`;

async function main(): Promise<void> {
  console.log('\nEvent Bus');
  {
    const bus = new EventBus();
    let n = 0;
    bus.subscribe(() => { n += 1; });
    const N = 1_000_000;
    const s = process.hrtime.bigint();
    for (let i = 0; i < N; i++) bus.publish(mk(i));
    const t = ms(s);
    console.log(`  publish · 1 subscriber · ${N.toLocaleString()} events   ${t.toFixed(0)} ms   ${rate(N, t)} (${n.toLocaleString()} deliveries)`);
  }
  {
    const bus = new EventBus();
    let n = 0;
    for (let k = 0; k < 10; k++) bus.subscribe(() => { n += 1; });
    const N = 200_000;
    const s = process.hrtime.bigint();
    for (let i = 0; i < N; i++) bus.publish(mk(i));
    const t = ms(s);
    console.log(`  publish · 10 subscribers · ${N.toLocaleString()} events  ${t.toFixed(0)} ms   ${rate(N, t)} (${n.toLocaleString()} deliveries)`);
  }
  {
    const bus = new EventBus({ onSubscriberError: () => {} });
    let ok = 0;
    bus.subscribe(() => { throw new Error('x'); });
    bus.subscribe(() => { ok += 1; });
    const N = 200_000;
    const s = process.hrtime.bigint();
    for (let i = 0; i < N; i++) bus.publish(mk(i));
    const t = ms(s);
    console.log(`  publish · throwing+good · ${N.toLocaleString()} events    ${t.toFixed(0)} ms   ${rate(N, t)} (${ok.toLocaleString()} good)`);
  }

  console.log('\nTimeline Service');
  const bus = new EventBus();
  const events: ReturnType<EventBus['publish']>[] = [];
  bus.subscribe((e) => events.push(e));
  for (let i = 0; i < 50_000; i++) bus.publish(mk(i));

  const dir = join(tmpdir(), 'nps-bench-' + Date.now());
  const tl = new TimelineService({ dir, batchSize: 10_000_000, flushIntervalMs: 10_000_000 });
  await tl.init();

  let s = process.hrtime.bigint();
  for (const e of events) tl.append(e);
  console.log(`  append · ${events.length.toLocaleString()} events             ${ms(s).toFixed(0)} ms   ${rate(events.length, ms(s))}`);

  s = process.hrtime.bigint();
  await tl.flush();
  const flushMs = ms(s);
  const stat = await fs.stat(join(dir, 'timeline.jsonl'));
  console.log(`  flush · ${events.length.toLocaleString()} events to JSONL    ${flushMs.toFixed(0)} ms   (${(stat.size / 1048576).toFixed(1)} MB, ${Math.round(stat.size / events.length)} B/event)`);

  const reps = 5000;
  s = process.hrtime.bigint();
  for (let i = 0; i < reps; i++) tl.query({ categories: ['runtime'], search: 'benchmark', limit: 50, order: 'desc' });
  console.log(`  query · filter+search over 5,000-window  ${(ms(s) / reps).toFixed(2)} ms/query`);

  await tl.dispose();
  await fs.rm(dir, { recursive: true, force: true });
  console.log('');
}

void main();
