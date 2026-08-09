/**
 * Per-section scroll memory.
 *
 * The behaviour people expect from a native app: leave a long list halfway
 * down, go somewhere else, come back, and be where you were. Losing that means
 * re-finding your place by hand every time you check something in another
 * section — a small cost paid constantly.
 *
 * Three rules keep it from becoming the *other* annoyance, restoring a
 * position that no longer makes sense:
 *
 *  1. **Only remember a real scroll.** A position of 0 is not a memory, it is
 *     the default. Storing it would make "restore" indistinguishable from
 *     "reset" and hide bugs in both.
 *  2. **Forget when the content changes.** A remembered offset belongs to a
 *     specific list. If the section is reloaded with different data, 1,200px
 *     down may now be past the end, or worse, a different row entirely.
 *  3. **Bounded.** One entry per section, nothing accumulating over a session.
 *
 * Pure and injectable: no DOM, no React, so the rules are testable directly
 * rather than through a rendered scroll container.
 */

export interface ScrollMemory {
  /** Remember where a section was left. */
  remember(sectionId: string, offset: number, contentKey?: string): void;
  /**
   * The offset to restore, or 0 when there is nothing meaningful to restore.
   * A `contentKey` mismatch discards the memory rather than restoring it.
   */
  recall(sectionId: string, contentKey?: string): number;
  forget(sectionId: string): void;
  clear(): void;
}

interface Entry {
  offset: number;
  contentKey: string;
}

/**
 * Below this, restoring is indistinguishable from not restoring, and the extra
 * scroll event is just a chance to fight the user's own momentum scrolling.
 */
export const MIN_REMEMBERED_OFFSET = 24;

export function createScrollMemory(): ScrollMemory {
  const entries = new Map<string, Entry>();
  return {
    remember(sectionId, offset, contentKey = '') {
      if (!Number.isFinite(offset) || offset < MIN_REMEMBERED_OFFSET) {
        entries.delete(sectionId);
        return;
      }
      entries.set(sectionId, { offset, contentKey });
    },
    recall(sectionId, contentKey = '') {
      const entry = entries.get(sectionId);
      if (!entry) return 0;
      // Different content behind the same section id: the offset is stale and
      // restoring it would land the user somewhere arbitrary.
      if (entry.contentKey !== contentKey) {
        entries.delete(sectionId);
        return 0;
      }
      return entry.offset;
    },
    forget(sectionId) {
      entries.delete(sectionId);
    },
    clear() {
      entries.clear();
    },
  };
}

/**
 * The scrollable element inside a freshly-mounted section.
 *
 * Views own their own scroll container (`ViewScroll` renders one), so there is
 * no single window scroller to address. Returns the first one that can
 * actually scroll — an element with no overflow has nothing to restore and
 * picking it would silently do nothing.
 */
export function findScroller(host: HTMLElement | null): HTMLElement | null {
  if (!host) return null;
  const candidates = host.querySelectorAll<HTMLElement>('.overflow-y-auto, .overflow-auto');
  for (const el of candidates) {
    if (el.scrollHeight > el.clientHeight) return el;
  }
  return candidates[0] ?? null;
}
