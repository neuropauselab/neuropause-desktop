import { describe, expect, it } from 'vitest';
import {
  classifyConnection,
  defaultToastDuration,
  dismissAllToasts,
  dismissToast,
  enqueueToast,
  type ConnectionInput,
  type ToastModel,
} from '@neuropause/shared';

const toast = (id: string, severity: ToastModel['severity'] = 'info', over: Partial<ToastModel> = {}): ToastModel => ({
  id,
  severity,
  title: id,
  durationMs: severity === 'error' ? 0 : 4000,
  createdAt: 0,
  ...over,
});

describe('UX — toast queue (deterministic)', () => {
  it('prepends newest-first and dismisses by id / all', () => {
    let list: ToastModel[] = [];
    list = enqueueToast(list, toast('a'));
    list = enqueueToast(list, toast('b'));
    expect(list.map((t) => t.id)).toEqual(['b', 'a']);
    expect(dismissToast(list, 'a').map((t) => t.id)).toEqual(['b']);
    expect(dismissAllToasts(list)).toEqual([]);
  });

  it('replaces in place on a matching dedupeKey (no stacking)', () => {
    let list: ToastModel[] = [];
    list = enqueueToast(list, toast('c1', 'warning', { dedupeKey: 'connection', title: 'Slow' }));
    list = enqueueToast(list, toast('x', 'info'));
    list = enqueueToast(list, toast('c2', 'error', { dedupeKey: 'connection', title: 'Offline' }));
    // still one 'connection' toast, replaced in its original slot with the new content
    expect(list.filter((t) => t.dedupeKey === 'connection')).toHaveLength(1);
    const conn = list.find((t) => t.dedupeKey === 'connection')!;
    expect(conn.id).toBe('c2');
    expect(conn.title).toBe('Offline');
    expect(list).toHaveLength(2);
  });

  it('caps the queue, dropping oldest non-error first (errors are sticky)', () => {
    let list: ToastModel[] = [];
    for (let i = 0; i < 6; i += 1) list = enqueueToast(list, toast(`i${i}`));
    expect(list).toHaveLength(5);
    expect(list.map((t) => t.id)).toEqual(['i5', 'i4', 'i3', 'i2', 'i1']); // oldest i0 dropped

    // an error deep in the queue survives while newer infos are dropped
    let mix: ToastModel[] = [toast('newA'), toast('newB'), toast('errOld', 'error')];
    mix = enqueueToast(mix.slice(1), mix[0], 2); // force cap 2 over 3 → drop oldest non-error (newB)
    expect(mix.map((t) => t.id)).toEqual(['newA', 'errOld']);
  });

  it('uses a persistent (0ms) duration for errors and timed durations otherwise', () => {
    expect(defaultToastDuration('error')).toBe(0);
    expect(defaultToastDuration('success')).toBeGreaterThan(0);
    expect(defaultToastDuration('warning')).toBeGreaterThan(defaultToastDuration('success'));
  });
});

describe('UX — connection classifier (from real signals)', () => {
  const base: ConnectionInput = { networkOnline: true, backendReachable: true, latencyMs: 20, sync: null };

  it('reports connecting before the first heartbeat', () => {
    expect(classifyConnection({ ...base, backendReachable: null }).state).toBe('connecting');
  });

  it('reports offline when the OS network is down (highest priority)', () => {
    const a = classifyConnection({ ...base, networkOnline: false });
    expect(a.state).toBe('offline');
    expect(a.tone).toBe('red');
  });

  it('reports degraded when the backend does not answer heartbeats', () => {
    expect(classifyConnection({ ...base, backendReachable: false, latencyMs: null }).state).toBe('degraded');
  });

  it('grades latency into online / slow / very-slow', () => {
    expect(classifyConnection({ ...base, latencyMs: 40 }).state).toBe('online');
    expect(classifyConnection({ ...base, latencyMs: 300 }).state).toBe('slow');
    expect(classifyConnection({ ...base, latencyMs: 1500 }).state).toBe('degraded');
  });

  it('surfaces sync error, pending and syncing state', () => {
    const err = classifyConnection({ ...base, sync: { state: 'error', online: true, pendingCount: 3 } });
    expect(err.state).toBe('degraded');
    expect(err.pending).toBe(3);
    const busy = classifyConnection({ ...base, sync: { state: 'syncing', online: true, pendingCount: 2 } });
    expect(busy.state).toBe('online');
    expect(busy.syncing).toBe(true);
    expect(busy.pending).toBe(2);
    expect(busy.detail).toContain('pending');
  });
});
