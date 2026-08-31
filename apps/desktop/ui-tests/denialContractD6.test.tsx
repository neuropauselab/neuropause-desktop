/**
 * D-6 — THE AUTHORIZATION ERROR CONTRACT, DRIVEN THROUGH THE REAL SURFACE.
 *
 * THE DEFECT, quoted from PROGRAM-13C-FINAL-CERTIFICATION.md: *"authorization
 * outcomes are distinguishable only by matching English prose. Rewording a
 * message silently changes renderer behaviour."*
 *
 * `denialCodeContract.test.ts` pins the contract as a unit. This file proves it
 * where it actually matters: a rejection crossing the REAL `invoke` chokepoint
 * into the REAL `BusinessView`, rendering the REAL denial state.
 *
 * THE CENTRAL PAIR is tests 1 and 2. Both send the SAME reworded sentence —
 * one that matches none of the regexes this contract replaced. Stamped, it
 * renders the denial state; unstamped, it renders the fault state. Same words,
 * different answers, and the ONLY difference is the machine code. That is D-6
 * closed, demonstrated rather than asserted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { DENIAL_CODE, DENIAL_STAMP_CLOSE, DENIAL_STAMP_OPEN } from '@renderer/lib/ipcError';

vi.mock('@renderer/state/ShellProvider', () => ({
  useShell: () => ({ businessTab: null, clearBusinessTab: () => undefined, setSection: () => undefined }),
}));

import { BusinessView } from '@renderer/business/BusinessView';

/** A refusal whose wording deliberately matches NONE of the replaced regexes. */
const REWORDED = 'Your role does not include this capability.';

function stamped(code: string, message: string): string {
  return `${DENIAL_STAMP_OPEN}${code}${DENIAL_STAMP_CLOSE}${message}`;
}

beforeEach(() => {
  cleanup();
  clearRoutes();
});

describe('D-6 · a denial is recognised by its code, not its wording', () => {
  it('a STAMPED refusal renders the denial state even though the wording matches no old regex', async () => {
    // Guard the premise: if this ever matches, the test has stopped proving
    // anything and would pass for the wrong reason.
    expect(/not authorized|permission|forbidden|denied/i.test(REWORDED)).toBe(false);

    route(IpcChannel.EnterpriseModulesList, () => {
      throw new Error(stamped(DENIAL_CODE.MISSING_PERMISSION, REWORDED));
    });
    render(<BusinessView />);

    expect(await screen.findByText('You don’t have access to Business')).toBeTruthy();
    // A denial offers no useless retry — the caller lacks access, not luck.
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
  });

  it('the SAME wording UNSTAMPED renders the fault state — the code is what decided', async () => {
    route(IpcChannel.EnterpriseModulesList, () => {
      throw new Error(REWORDED);
    });
    render(<BusinessView />);

    // Not a denial: no code, and the prose fallback does not match either. The
    // surface says "this is broken", which is the honest answer for an
    // unclassifiable failure.
    expect(await screen.findByRole('button', { name: /Try again/ })).toBeTruthy();
    expect(screen.queryByText('You don’t have access to Business')).toBeNull();
  });

  it('the wire stamp NEVER reaches the screen', async () => {
    route(IpcChannel.EnterpriseModulesList, () => {
      throw new Error(stamped(DENIAL_CODE.MISSING_PERMISSION, REWORDED));
    });
    const { container } = render(<BusinessView />);
    await screen.findByText('You don’t have access to Business');

    // The stamp is transport. A user must never read it, and neither must a
    // screenshot in a support bundle.
    expect(container.textContent ?? '').not.toContain(DENIAL_STAMP_OPEN);
    expect(container.textContent ?? '').not.toContain(DENIAL_CODE.MISSING_PERMISSION);
  });

  it('a legacy UNSTAMPED denial still works — the prose fallback is intact', async () => {
    // Not every denial flows through the stamping bridge yet (the REST gateway
    // calls runSecureHandler directly). Dropping the fallback would turn a
    // working denial banner into a blank screen.
    route(IpcChannel.EnterpriseModulesList, () => {
      throw new Error('Not authorized: missing permission "crm:read".');
    });
    render(<BusinessView />);
    expect(await screen.findByText('You don’t have access to Business')).toBeTruthy();
  });

  it('an ordinary fault is still a fault, not a refusal', async () => {
    route(IpcChannel.EnterpriseModulesList, () => {
      throw new Error('The module registry is unavailable.');
    });
    render(<BusinessView />);
    expect(await screen.findByRole('button', { name: /Try again/ })).toBeTruthy();
    expect(screen.queryByText('You don’t have access to Business')).toBeNull();
  });
});
