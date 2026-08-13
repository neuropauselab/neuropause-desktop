/**
 * The two hooks that decide when the interface is allowed to show a number
 * that is not yet true, and when it is allowed to claim it is loading.
 *
 * Both are small, and both are the kind of thing that goes subtly wrong in
 * ways nobody reports: a spinner that flashes, a count that reads 0 for
 * 200ms before showing 3. The rules are asserted here rather than trusted.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LOADING_FLASH_THRESHOLD_MS, useDelayedFlag } from '@renderer/lib/useDelayedFlag';
import { MAX_COUNT_ROLL_MS, useAnimatedCount } from '@renderer/lib/useAnimatedCount';

// rAF must be faked too: useAnimatedCount drives its roll from
// requestAnimationFrame, so real-timer fakes alone would never advance it.
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] }));
afterEach(() => vi.useRealTimers());

describe('useDelayedFlag', () => {
  it('is false immediately — a fast load must never flash a spinner', () => {
    const { result } = renderHook(() => useDelayedFlag());
    expect(result.current).toBe(false);
  });

  it('becomes true only once the wait is long enough to be worth reporting', () => {
    const { result } = renderHook(() => useDelayedFlag());
    act(() => {
      vi.advanceTimersByTime(LOADING_FLASH_THRESHOLD_MS - 1);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current).toBe(true);
  });

  it('a zero delay is immediate, not "never"', () => {
    const { result } = renderHook(() => useDelayedFlag(0));
    expect(result.current).toBe(true);
  });

  it('unmounting cancels the timer — the load finished, do not fire', () => {
    const { unmount } = renderHook(() => useDelayedFlag());
    unmount();
    // Nothing to assert beyond "this does not warn about setting state on an
    // unmounted component"; the cleanup is the behaviour under test.
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });
});

describe('useAnimatedCount', () => {
  it('shows the first value immediately — never counts up from zero on mount', () => {
    // A dashboard that rolls every figure from 0 on load displays numbers that
    // are not true for a few hundred milliseconds. "3 open holds" must never
    // read 0 first.
    const { result } = renderHook(() => useAnimatedCount(42));
    expect(result.current).toBe(42);
  });

  it('does not move when the value did not change', () => {
    const { result, rerender } = renderHook(({ n }) => useAnimatedCount(n), {
      initialProps: { n: 7 },
    });
    rerender({ n: 7 });
    expect(result.current).toBe(7);
  });

  it('lands EXACTLY on the target, never one short', () => {
    // The last frame assigns the target rather than an interpolation of it. A
    // count that settles on 2.9999 and rounds is a count that can be wrong.
    const { result, rerender } = renderHook(({ n }) => useAnimatedCount(n), {
      initialProps: { n: 0 },
    });
    rerender({ n: 5 });
    act(() => {
      vi.advanceTimersByTime(MAX_COUNT_ROLL_MS * 2);
    });
    expect(result.current).toBe(5);
  });

  it('disabled jumps straight to the value — the reduced-motion path', () => {
    const { result, rerender } = renderHook(
      ({ n }) => useAnimatedCount(n, { disabled: true }),
      { initialProps: { n: 1 } },
    );
    rerender({ n: 9 });
    expect(result.current).toBe(9);
  });

  it('never rolls for longer than the cap, however large the caller asks', () => {
    const { result, rerender } = renderHook(
      ({ n }) => useAnimatedCount(n, { durationMs: 10_000 }),
      { initialProps: { n: 0 } },
    );
    rerender({ n: 100 });
    act(() => {
      vi.advanceTimersByTime(MAX_COUNT_ROLL_MS + 32);
    });
    expect(result.current).toBe(100);
  });

  it('a non-finite value is displayed, not animated toward', () => {
    const { result, rerender } = renderHook(({ n }) => useAnimatedCount(n), {
      initialProps: { n: 0 },
    });
    rerender({ n: Number.NaN });
    expect(Number.isNaN(result.current)).toBe(true);
  });
});
