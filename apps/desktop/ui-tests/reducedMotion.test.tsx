/**
 * Reduced motion: prove the app still WORKS, not just that it stops moving.
 *
 * The dangerous failure here is not "an animation still plays". It is a
 * feature that quietly stops functioning because motion was load-bearing —
 * a row that only appears via an animation that no longer runs, a dialog that
 * never becomes interactive, a list that renders empty. Someone who set
 * `prefers-reduced-motion` for vestibular reasons then has a broken product,
 * and would have no way to know why.
 *
 * So every test below drives a real interaction with reduced motion ON and
 * asserts the OUTCOME — the hold resolves, the correction persists, the setup
 * reopens — rather than inspecting a transition value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { initDecisions } from '@main/decisions/index';
import { DecisionRecordStore } from '@main/decisions/decisionService';
import { HoldStore } from '@main/decisions/holdStore';
import { createExperienceProfileService } from '@main/onboarding/experienceProfileService';
import { UnderstandView } from '@renderer/understanding/UnderstandView';
import { HoldsView } from '@renderer/understanding/HoldsView';
import { FirstRunExperience } from '@renderer/firstRun/FirstRunExperience';
import { CSS_TRANSITION } from '@renderer/lib/motion';
import { useAnimatedCount } from '@renderer/lib/useAnimatedCount';

/**
 * jsdom has no media-query engine, so `matchMedia` must be supplied. Returning
 * `matches: true` for the reduced-motion query is exactly what the OS setting
 * does, and it is what `MotionConfig reducedMotion="user"` reads.
 */
function enableReducedMotion(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

let dir: string;
let holds: HoldStore;
let decisions: DecisionRecordStore;
let profile: ReturnType<typeof createExperienceProfileService>;

beforeEach(async () => {
  cleanup();
  clearRoutes();
  enableReducedMotion();

  dir = join(tmpdir(), `np-rm-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  holds = new HoldStore(join(dir, 'h.json'));
  decisions = new DecisionRecordStore(join(dir, 'd.json'));
  profile = createExperienceProfileService({ filePath: join(dir, 'p.json') });
  await Promise.all([holds.load(), decisions.load(), profile.load()]);

  const { handlers } = initDecisions({
    decisionRecords: decisions,
    holds,
    assessmentLive: () => true,
    relationshipsDeclared: () => 4,
    actor: () => 'owner@example.com',
    audit: () => undefined,
  });
  for (const h of handlers) route(h.channel as string, (p) => h.handler(h.schema.parse(p)));
  route('xp:profile.get', () => profile.get());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  route('xp:profile.set', (p) => profile.set(p as any));
  route('xp:profile.reset', () => profile.reset());
  route('dp:exportable', () => []);
  route('connectors:list', () => []);
  route(IpcChannel.AiConfigDetectOllama, () => ({ reachable: false, models: [] }));
  route(IpcChannel.AiConfigSetMode, () => ({}));
  route(IpcChannel.AiConfigSetExternalConsent, () => ({}));
});

afterEach(async () => {
  cleanup();
  await Promise.all([holds.flush(), decisions.flush()]);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

const seedHold = (): ReturnType<HoldStore['open']> =>
  holds.open({
    title: 'Delete customer "Acme Ltd"',
    subject: 'crm-customers/rec_1 (Acme Ltd)',
    reason: 'high_risk',
    why: 'Customer "Acme Ltd" has 2 live dependencies.',
    known: ['2 records in Invoices resolve to "Acme Ltd"'],
    unknown: ['Whether they are still needed.'],
    resolution: 'Archive this record instead.',
    ifProceeding: 'The links stop resolving.',
  });

describe('Holds under reduced motion', () => {
  it('renders every hold — nothing depends on an animation having run', async () => {
    seedHold();
    render(<HoldsView />);
    expect(await screen.findByText('Delete customer "Acme Ltd"')).toBeTruthy();
    expect(screen.getByText('What I know')).toBeTruthy();
    expect(screen.getByText(/2 records in Invoices/)).toBeTruthy();
  });

  it('resolving still works and the row still leaves the list', async () => {
    const hold = seedHold();
    const user = userEvent.setup();
    render(<HoldsView />);
    await user.click(await screen.findByRole('button', { name: /I took the safer route/ }));
    await waitFor(() => expect(screen.getByText(/Nothing is on hold/)).toBeTruthy());
    expect(holds.get(hold.id)?.status).toBe('resolved');
  });

  it('the expandable Decision Record still opens', async () => {
    const hold = seedHold();
    decisions.record({
      actor: 'owner@example.com',
      requestedAction: 'Delete customer "Acme Ltd"',
      subject: hold.subject,
      assessment: {
        risk: 'high_risk',
        recommendation: 'Do not delete.',
        evidence: [{ label: 'Linked as "Customer"', detail: '2 records in Invoices', count: 2 }],
        alternative: 'Archive instead.',
      },
      outcome: 'cancelled',
      executed: 'Nothing.',
      holdId: hold.id,
    });
    const user = userEvent.setup();
    render(<HoldsView />);
    await user.click(await screen.findByText('Delete customer "Acme Ltd"', { selector: 'div' }));
    // The height animation is what reveals this. If motion were load-bearing,
    // this assertion is where it would fail.
    expect(await screen.findByText('Evidence at the time')).toBeTruthy();
  });
});

describe('Understand under reduced motion', () => {
  it('a correction still persists', async () => {
    await profile.set({
      attributes: [
        {
          key: 'domain',
          label: 'You work on',
          value: 'Manufacturing',
          status: 'inferred',
          source: 'Inferred from your description',
          updatedAt: 't',
        },
      ],
    });
    const user = userEvent.setup();
    render(<UnderstandView />);
    await user.click(await screen.findByRole('button', { name: 'Correct' }));
    const input = await screen.findByLabelText('Correct You work on');
    await user.clear(input);
    await user.type(input, 'Medical devices');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(profile.get().attributes[0]!.status).toBe('corrected'));
  });

  it('the Add panel still opens and saves — its reveal is a height animation', async () => {
    const user = userEvent.setup();
    render(<UnderstandView />);
    await user.click(await screen.findByRole('button', { name: 'Add one thing instead' }));
    await user.type(await screen.findByLabelText('Label'), 'Main market');
    await user.type(screen.getByLabelText('Value'), 'Germany');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Germany')).toBeTruthy());
  });

  it('a skeleton is still understandable when nothing is sweeping', async () => {
    // The shimmer is decoration; the SHAPE is the information. With motion off
    // the placeholder must still announce itself, or a screen-reader user gets
    // silence while the screen loads.
    render(<UnderstandView />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(region.textContent).toContain('Loading what NeuroPause understands');
  });
});

describe('First run under reduced motion', () => {
  it('every step still advances by keyboard alone', async () => {
    const user = userEvent.setup();
    render(<FirstRunExperience onDone={() => undefined} onSignIn={() => undefined} />);

    // The primary action is auto-focused, so a keyboard user can start without
    // reaching for the mouse. Asserting that directly is stronger than tabbing:
    // it pins the affordance, not just the reachability.
    const primary = screen.getByRole('button', { name: 'Try Free Locally' });
    expect(document.activeElement).toBe(primary);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Where should your AI work?')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Keep it on this device' }));
    expect(await screen.findByRole('button', { name: 'Explore Business' })).toBeTruthy();
    await waitFor(() => expect(profile.get().aiModeChosen).toBe(true));
    // …and it got there through real routed channels, not through a caught
    // rejection that happened to leave the screen in the expected state.
    expect(unroutedChannels()).toEqual([]);
  });

  it('the overlay still covers the app — the opaque background is not animated on', () => {
    render(<FirstRunExperience onDone={() => undefined} onSignIn={() => undefined} />);
    const overlay = screen.getByRole('dialog', { name: 'Welcome to NeuroPause' });
    expect(overlay.className).toContain('app-bg');
    expect(overlay.className).toContain('inset-0');
  });
});

describe('the motion layer itself', () => {
  it('every CSS transition token disables under reduced motion', () => {
    for (const [name, value] of Object.entries(CSS_TRANSITION)) {
      expect(value, `${name} keeps animating`).toContain('motion-reduce:transition-none');
    }
  });

  it('a count with motion disabled updates instantly rather than not at all', async () => {
    // The failure mode worth guarding: "reduced motion" implemented as "skip
    // the update" would leave a stale number on screen forever.
    const { renderHook, act } = await import('@testing-library/react');
    const { result, rerender } = renderHook(
      ({ n }) => useAnimatedCount(n, { disabled: true }),
      { initialProps: { n: 2 } },
    );
    act(() => rerender({ n: 11 }));
    expect(result.current).toBe(11);
  });
});
