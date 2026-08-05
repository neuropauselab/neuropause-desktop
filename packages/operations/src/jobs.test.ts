import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { Scheduler } from '@neuropause/runtime';
import { JobQueue, InMemoryJobStore, PoisonMessageError, BackpressureError } from './jobs';

describe('Job & Queue Reliability (Phase 4)', () => {
  it('runs a job to success and drains by priority', async () => {
    const q = new JobQueue(new ManualClock(0));
    const order: number[] = [];
    q.registerHandler('p', async (p: { n: number }) => {
      order.push(p.n);
    });
    q.enqueue({ type: 'p', payload: { n: 1 }, priority: 1 });
    const hi = q.enqueue({ type: 'p', payload: { n: 5 }, priority: 5 });
    await q.drain();
    expect(order).toEqual([5, 1]); // highest priority first
    expect(q.get(hi.id)?.state).toBe('succeeded');
  });

  it('honours delayed execution', async () => {
    const clock = new ManualClock(0);
    const q = new JobQueue(clock);
    q.registerHandler('d', async () => undefined);
    const j = q.enqueue({ type: 'd', payload: {}, delayMs: 1000 });
    expect(j.state).toBe('delayed');
    await q.drain();
    expect(q.get(j.id)?.state).toBe('delayed'); // not yet due
    clock.advance(1000);
    await q.drain();
    expect(q.get(j.id)?.state).toBe('succeeded');
  });

  it('retries transient failures then dead-letters at maxAttempts', async () => {
    const clock = new ManualClock(0);
    const q = new JobQueue(clock, { rng: () => 0, defaultMaxAttempts: 2 });
    q.registerHandler('fail', async () => {
      throw new Error('temporarily unavailable');
    });
    const j = q.enqueue({ type: 'fail', payload: {} });
    await q.drain(); // attempt 1 → delayed for retry
    expect(q.get(j.id)?.state).toBe('delayed');
    expect(q.get(j.id)?.attempts).toBe(1);
    clock.advance(200); // backoff (base 200, jitter 0)
    await q.drain(); // attempt 2 → dead
    expect(q.get(j.id)?.state).toBe('dead');
    expect(q.deadLetter()).toHaveLength(1);
  });

  it('sends poison messages and permanent failures straight to the DLQ', async () => {
    const q = new JobQueue(new ManualClock(0), { defaultMaxAttempts: 5 });
    q.registerHandler('poison', async () => {
      throw new PoisonMessageError('bad message');
    });
    q.registerHandler('perm', async () => {
      throw new Error('invalid payload');
    });
    const jp = q.enqueue({ type: 'poison', payload: {} });
    const jperm = q.enqueue({ type: 'perm', payload: {} });
    await q.drain();
    expect(q.get(jp.id)?.state).toBe('dead');
    expect(q.get(jp.id)?.attempts).toBe(1); // no retries for poison
    expect(q.get(jperm.id)?.state).toBe('dead'); // permanent ⇒ no retries
  });

  it('recovers via checkpoints across a retry', async () => {
    const clock = new ManualClock(0);
    const q = new JobQueue(clock, { rng: () => 0, defaultMaxAttempts: 2 });
    const seen: unknown[] = [];
    q.registerHandler('ckpt', async (_p, ctx) => {
      seen.push(ctx.previousCheckpoint);
      if (ctx.attempt === 1) {
        ctx.checkpoint({ step: 1 });
        throw new Error('timeout');
      }
      return 'ok';
    });
    const j = q.enqueue({ type: 'ckpt', payload: {} });
    await q.drain();
    clock.advance(200);
    await q.drain();
    expect(seen).toEqual([undefined, { step: 1 }]); // second attempt resumes from checkpoint
    expect(q.get(j.id)?.state).toBe('succeeded');
  });

  it('cancels, replays a dead job, and recovers interrupted jobs', async () => {
    const clock = new ManualClock(0);
    // cancellation
    const q = new JobQueue(clock);
    const jc = q.enqueue({ type: 'x', payload: {} });
    expect(q.cancel(jc.id)).toBe(true);
    await q.drain();
    expect(q.get(jc.id)?.state).toBe('cancelled'); // cancelled ⇒ never runs

    // replay from DLQ
    const jd = q.enqueue({ type: 'x', payload: {} }); // no handler ⇒ dead on drain
    await q.drain();
    expect(q.get(jd.id)?.state).toBe('dead');
    const replayed = q.replay(jd.id);
    expect(replayed?.state).toBe('pending');
    expect(replayed?.attempts).toBe(0);

    // interrupted-job recovery
    const store = new InMemoryJobStore();
    store.save({ id: 'stuck', type: 't', payload: {}, priority: 0, state: 'running', attempts: 1, maxAttempts: 3, runAt: 0, createdAt: 0, updatedAt: 0 });
    const q2 = new JobQueue(clock, { store });
    expect(q2.recover().recovered).toBe(1);
    expect(q2.get('stuck')?.state).toBe('pending');
  });

  it('applies backpressure at the depth ceiling', () => {
    const q = new JobQueue(new ManualClock(0), { maxDepth: 2 });
    q.enqueue({ type: 't', payload: {} });
    q.enqueue({ type: 't', payload: {} });
    expect(() => q.enqueue({ type: 't', payload: {} })).toThrow(BackpressureError);
  });

  it('drains on ticks of the EXISTING runtime scheduler', async () => {
    const clock = new ManualClock(0);
    const scheduler = new Scheduler(clock);
    const q = new JobQueue(clock);
    let ran = false;
    q.registerHandler('s', async () => {
      ran = true;
    });
    q.enqueue({ type: 's', payload: {} });
    q.attachToScheduler(scheduler, 100);
    expect(scheduler.names()).toContain('ops.jobs.drain');
    clock.advance(100);
    await scheduler.tick();
    expect(ran).toBe(true);
  });
});
