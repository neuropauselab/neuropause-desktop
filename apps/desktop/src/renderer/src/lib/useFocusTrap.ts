/**
 * P13C ROUND 36 — GATE 12. FOCUS STAYS INSIDE AN OPEN DIALOG.
 *
 * The audit's finding: no focus trap existed anywhere — every modal, including
 * the destructive-delete alertdialog, leaked Tab into the shell behind it, and
 * none restored focus on close. `aria-modal="true"` announces a contract to
 * assistive tech that the DOM then broke.
 *
 * One hook, applied at the dialog primitives: while `active`, Tab and
 * Shift+Tab cycle within the container, initial focus moves to the first
 * focusable element (or the container itself), and on deactivation focus
 * returns to the element that had it. Deliberately dependency-free and small —
 * a sentinel-node library is not needed for a keydown-cycled trap.
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(containerRef: RefObject<HTMLElement>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Visibility filter is attribute-based, not `offsetParent`: offsetParent
    // is null for descendants of some fixed-position stacks and is not
    // implemented in jsdom at all — both would silently empty the trap.
    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.closest('[hidden]') === null && el.getAttribute('aria-hidden') !== 'true',
      );

    // Initial focus: the first focusable control, else the container.
    const first = focusables()[0];
    if (first) first.focus();
    else {
      container.tabIndex = -1;
      container.focus();
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const current = document.activeElement as HTMLElement | null;
      const index = current ? items.indexOf(current) : -1;
      if (e.shiftKey) {
        if (index <= 0) {
          e.preventDefault();
          items[items.length - 1].focus();
        }
      } else if (index === items.length - 1 || index === -1) {
        e.preventDefault();
        items[0].focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [containerRef, active]);
}
