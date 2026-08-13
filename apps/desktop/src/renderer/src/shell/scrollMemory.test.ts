/**
 * Scroll memory. Two ways to get this wrong, and they pull in opposite
 * directions:
 *
 *  - Restore too little and the user re-finds their place by hand every time
 *    they check something in another section.
 *  - Restore too eagerly and they land somewhere arbitrary — a remembered
 *    offset applied to content that has since changed is worse than the top of
 *    the page, because it looks deliberate.
 *
 * The rules below are the boundary between those two.
 */
import { describe, expect, it } from 'vitest';
import { MIN_REMEMBERED_OFFSET, createScrollMemory } from './scrollMemory';

describe('createScrollMemory', () => {
  it('recalls a real position', () => {
    const memory = createScrollMemory();
    memory.remember('holds', 840);
    expect(memory.recall('holds')).toBe(840);
  });

  it('a section never visited restores to the top', () => {
    expect(createScrollMemory().recall('never-seen')).toBe(0);
  });

  it('the top of a page is not a position worth remembering', () => {
    // Storing 0 would make "restore" and "reset" indistinguishable, hiding
    // bugs in both.
    const memory = createScrollMemory();
    memory.remember('holds', 0);
    expect(memory.recall('holds')).toBe(0);
  });

  it('a nudge below the threshold is not a position either', () => {
    const memory = createScrollMemory();
    memory.remember('holds', MIN_REMEMBERED_OFFSET - 1);
    expect(memory.recall('holds')).toBe(0);
    memory.remember('holds', MIN_REMEMBERED_OFFSET);
    expect(memory.recall('holds')).toBe(MIN_REMEMBERED_OFFSET);
  });

  it('re-remembering replaces rather than accumulating', () => {
    const memory = createScrollMemory();
    memory.remember('holds', 400);
    memory.remember('holds', 900);
    expect(memory.recall('holds')).toBe(900);
  });

  it('sections do not leak into each other', () => {
    const memory = createScrollMemory();
    memory.remember('holds', 400);
    memory.remember('understand', 120);
    expect(memory.recall('holds')).toBe(400);
    expect(memory.recall('understand')).toBe(120);
  });

  it('DISCARDS the memory when the content behind the section changed', () => {
    // The most important rule. 1,200px into yesterday's list is a different
    // row — or past the end — in today's.
    const memory = createScrollMemory();
    memory.remember('data-center', 1200, 'import-run-1');
    expect(memory.recall('data-center', 'import-run-2')).toBe(0);
    // …and the stale entry is gone, not merely skipped this once.
    expect(memory.recall('data-center', 'import-run-1')).toBe(0);
  });

  it('a non-finite offset is refused rather than stored', () => {
    const memory = createScrollMemory();
    memory.remember('holds', Number.NaN);
    expect(memory.recall('holds')).toBe(0);
  });

  it('forget and clear do what they say', () => {
    const memory = createScrollMemory();
    memory.remember('a', 300);
    memory.remember('b', 300);
    memory.forget('a');
    expect(memory.recall('a')).toBe(0);
    expect(memory.recall('b')).toBe(300);
    memory.clear();
    expect(memory.recall('b')).toBe(0);
  });
});
