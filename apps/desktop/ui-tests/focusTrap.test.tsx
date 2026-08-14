/**
 * P13C ROUND 36 — GATE 12. `aria-modal` finally means what it says.
 *
 * The failure being pinned: no focus trap existed in any dialog — Tab walked
 * out of an open modal into the shell behind it, and closing never restored
 * focus to the opener. These tests drive the shared `Modal` primitive (the
 * NPDS surface the enterprise modules use) through the real hook.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import React, { useState } from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '@renderer/components/ui/Modal';

function Harness(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <button type="button">Behind the modal</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Test dialog">
        <button type="button">First</button>
        <button type="button">Second</button>
      </Modal>
    </div>
  );
}

beforeEach(() => cleanup());

describe('Modal focus trap (round 36)', () => {
  it('moves focus into the dialog on open', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it('Tab cycles inside the dialog — the shell behind it is unreachable', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // Walk further than the dialog has focusables; focus must never escape.
    for (let i = 0; i < 6; i += 1) {
      fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    // And backwards.
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab', shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Escape closes and focus returns to the opener', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
