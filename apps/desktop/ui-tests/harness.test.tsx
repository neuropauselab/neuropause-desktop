/**
 * The UI harness itself, under test.
 *
 * Both assertions here come from bugs that cost real debugging time while
 * building this suite. A harness that is subtly wrong does not fail loudly —
 * it makes the PRODUCT look broken, which is the worst possible failure mode
 * for a verification tool.
 */
import { describe, expect, it } from 'vitest';
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';

describe('the motion mock', () => {
  it('keeps a STABLE component identity per tag', () => {
    // A Proxy that builds a new function per access hands React a new element
    // type every render. React then remounts the subtree instead of updating
    // it, state changes appear to do nothing, and every click looks dead.
    expect(motion.div).toBe(motion.div);
    expect(motion.span).not.toBe(motion.div);
  });

  it('lets state updates inside a motion subtree actually render', async () => {
    function Counter(): JSX.Element {
      const [n, setN] = useState(0);
      return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <button type="button" onClick={() => setN((v) => v + 1)}>
            count {n}
          </button>
        </motion.div>
      );
    }
    const user = userEvent.setup();
    render(<Counter />);
    await user.click(screen.getByRole('button', { name: 'count 0' }));
    expect(await screen.findByRole('button', { name: 'count 1' })).toBeTruthy();
    cleanup();
  });
});

describe('the IPC bridge stub', () => {
  it('dispatches to the routed handler and surfaces unrouted channels loudly', async () => {
    clearRoutes();
    route('xp:profile.get', () => ({ ok: true }));
    await expect(window.neuropause.invoke('xp:profile.get')).resolves.toEqual({ ok: true });
    // An unrouted channel must throw, not resolve undefined: a silent
    // undefined would let a screen render an empty state that looks real.
    await expect(window.neuropause.invoke('hold:list')).rejects.toThrow('UNROUTED_CHANNEL');
    clearRoutes();
  });
});
