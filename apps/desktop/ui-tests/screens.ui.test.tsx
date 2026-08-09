/**
 * VISUAL / BEHAVIOURAL VERIFICATION of the new screens.
 *
 * These render the REAL React components into a real DOM and drive them with
 * real clicks, against the REAL main-process handlers over real files. They
 * are the closest thing to "open the app and look" that can run headlessly,
 * and they catch precisely what a unit test of the model cannot: a screen that
 * renders nothing, a button wired to no handler, state that does not refresh
 * after a write, an empty state that reads as an all-clear.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';

import { initDecisions } from '@main/decisions/index';
import { DecisionRecordStore } from '@main/decisions/decisionService';
import { HoldStore } from '@main/decisions/holdStore';
import { createExperienceProfileService } from '@main/onboarding/experienceProfileService';
import { UnderstandView } from '@renderer/understanding/UnderstandView';
import { HoldsView } from '@renderer/understanding/HoldsView';

const DIR = join(tmpdir(), 'np-ui-verification');

let dir: string;
let holds: HoldStore;
let decisions: DecisionRecordStore;
let live = true;

async function wireBackend(): Promise<void> {
  dir = join(DIR, randomUUID());
  await fs.mkdir(dir, { recursive: true });
  live = true;
  holds = new HoldStore(join(dir, 'holds.json'));
  decisions = new DecisionRecordStore(join(dir, 'decisions.json'));
  await Promise.all([holds.load(), decisions.load()]);

  const profile = createExperienceProfileService({ filePath: join(dir, 'profile.json') });
  await profile.load();

  const { handlers } = initDecisions({
    decisionRecords: decisions,
    holds,
    assessmentLive: () => live,
    relationshipsDeclared: () => 12,
    actor: () => 'owner@example.com',
    audit: () => undefined,
  });
  for (const h of handlers) {
    route(h.channel as string, (p) => h.handler(h.schema.parse(p)));
  }
  route('xp:profile.get', () => profile.get());
  route('xp:profile.reset', () => profile.reset());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  route('xp:profile.set', (p) => profile.set(p as any));
  // Real shapes, empty — the screens must handle "nothing yet" honestly.
  route('dp:exportable', () => []);
  route('connectors:list', () => []);
}

beforeEach(wireBackend);
afterEach(async () => {
  cleanup();
  clearRoutes();
  await Promise.all([holds.flush(), decisions.flush()]);
});

const openHold = (): ReturnType<HoldStore['open']> =>
  holds.open({
    title: 'Delete customer "Acme Ltd"',
    subject: 'crm-customers/rec_1 (Acme Ltd)',
    reason: 'high_risk',
    why: 'Acme Ltd has 2 live dependencies.',
    known: ['2 records in finance resolve to "Acme Ltd"'],
    unknown: ['Whether those dependencies are still needed.'],
    resolution: 'Archive this record instead.',
    ifProceeding: 'The links stop resolving.',
  });

describe('Holds screen', () => {
  it('renders an honest empty state, not a blank page', async () => {
    render(<HoldsView />);
    expect(await screen.findByText('Holds & decisions')).toBeTruthy();
    expect(await screen.findByText(/Nothing is on hold/)).toBeTruthy();
    expect(await screen.findByText(/No consequential decisions have been recorded/)).toBeTruthy();
  });

  it('shows a real hold with all five explanations', async () => {
    openHold();
    render(<HoldsView />);
    expect(await screen.findByText('Delete customer "Acme Ltd"')).toBeTruthy();
    expect(screen.getByText(/On hold · High risk/)).toBeTruthy();
    expect(screen.getByText('What I know')).toBeTruthy();
    expect(screen.getByText(/2 records in finance resolve/)).toBeTruthy();
    expect(screen.getByText("What I don't know")).toBeTruthy();
    expect(screen.getByText('What would resolve this')).toBeTruthy();
    expect(screen.getByText('If you proceed anyway')).toBeTruthy();
  });

  it('resolving a hold really resolves it and writes a Decision Record', async () => {
    const hold = openHold();
    const user = userEvent.setup();
    render(<HoldsView />);
    await user.click(await screen.findByRole('button', { name: /I took the safer route/ }));

    // The screen refreshes from the backend, not from local state.
    await waitFor(() => expect(screen.getByText(/Nothing is on hold/)).toBeTruthy());
    expect(holds.get(hold.id)?.status).toBe('resolved');
    expect(holds.get(hold.id)?.resolvedOutcome).toBe('took_alternative');

    // …and the decision trail now shows the resolution, expandable to evidence.
    const entry = await screen.findByText('Resolve hold: Delete customer "Acme Ltd"');
    await user.click(entry);
    expect(await screen.findByText('Evidence at the time')).toBeTruthy();
    expect(screen.getByText(/2 records in finance resolve/)).toBeTruthy();
    expect(screen.getByText('Subject')).toBeTruthy();
  });

  it('an unbound assessor is stated on screen — never presented as an all-clear', async () => {
    live = false;
    render(<HoldsView />);
    expect(
      await screen.findByText(/Dependency assessment is not active/),
    ).toBeTruthy();
  });
});

describe('Understand screen', () => {
  it('separates what you said from what NeuroPause guessed', async () => {
    await window.neuropause.invoke('xp:profile.set', {
      attributes: [
        {
          key: 'role',
          label: 'You',
          value: 'Business owner',
          status: 'stated',
          source: 'Your answer to "What best describes you?"',
          updatedAt: 't',
        },
        {
          key: 'domain',
          label: 'You work on',
          value: 'Manufacturing',
          status: 'inferred',
          source: 'Inferred from your description: “we make parts”',
          updatedAt: 't',
        },
      ],
    });
    render(<UnderstandView />);

    expect(await screen.findByRole('heading', { name: 'Confirmed by you' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Inferred — not yet confirmed' })).toBeTruthy();
    expect(screen.getByText('Business owner')).toBeTruthy();
    expect(screen.getByText('Manufacturing')).toBeTruthy();
    // The evidence sentence is on screen, not hidden behind a tooltip.
    expect(screen.getByText(/Inferred from your description/)).toBeTruthy();
    // Coverage counts are real.
    expect(screen.getByText('Awaiting confirmation')).toBeTruthy();
  });

  it('confirming an inference persists it as stated and re-groups on screen', async () => {
    await window.neuropause.invoke('xp:profile.set', {
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

    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Inferred — not yet confirmed' })).toBeNull(),
    );
    expect(screen.getByRole('heading', { name: 'Confirmed by you' })).toBeTruthy();

    // Persisted, not just local: read it back through the real service.
    const persisted = (await window.neuropause.invoke('xp:profile.get')) as {
      attributes: { key: string; status: string; source: string }[];
    };
    expect(persisted.attributes[0]!.status).toBe('stated');
    expect(persisted.attributes[0]!.source).toContain('You confirmed this');
  });

  it('a correction is written as `corrected`, remembering what was wrong', async () => {
    await window.neuropause.invoke('xp:profile.set', {
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

    await waitFor(() => expect(screen.getByText('Medical devices')).toBeTruthy());
    const persisted = (await window.neuropause.invoke('xp:profile.get')) as {
      attributes: { status: string; source: string; value: string }[];
    };
    expect(persisted.attributes[0]!.status).toBe('corrected');
    expect(persisted.attributes[0]!.value).toBe('Medical devices');
    expect(persisted.attributes[0]!.source).toContain('Manufacturing');
  });

  it('forget really removes the belief', async () => {
    await window.neuropause.invoke('xp:profile.set', {
      attributes: [
        { key: 'role', label: 'You', value: 'Founder', status: 'stated', source: 's', updatedAt: 't' },
      ],
    });
    const user = userEvent.setup();
    render(<UnderstandView />);
    await user.click(await screen.findByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(screen.queryByText('Founder')).toBeNull());
    const persisted = (await window.neuropause.invoke('xp:profile.get')) as { attributes: unknown[] };
    expect(persisted.attributes).toHaveLength(0);
  });

  it('an empty profile says so plainly instead of implying knowledge', async () => {
    render(<UnderstandView />);
    expect(await screen.findByText(/You haven.t told NeuroPause anything yet/)).toBeTruthy();
  });

  /**
   * The exact state seen on a real install: derived attributes exist (record
   * counts, a connected account) but the person has been asked nothing. The
   * old check was `all.length === 0`, so the derived rows silently suppressed
   * the empty state and the screen showed a wall of machine facts with no
   * acknowledgement that setup never happened and no way back to it.
   */
  it('still says "you have told us nothing" when only DERIVED facts exist', async () => {
    clearRoutes();
    await wireBackend();
    route('dp:exportable', () => [
      { moduleId: 'fin', title: 'Finance', plural: 'Finance', group: null, recordCount: 1, importedCount: 0 },
      { moduleId: 'crm', title: 'CRM', plural: 'CRM', group: null, recordCount: 1, importedCount: 0 },
    ]);

    render(<UnderstandView />);
    // The derived facts DO show…
    expect(await screen.findByText(/2 records across 2 areas/)).toBeTruthy();
    // …and so does the honest statement about what is missing, with a way out.
    expect(screen.getByText(/You haven.t told NeuroPause anything yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Answer the setup questions' })).toBeTruthy();
    // Tied counts must not claim a "largest".
    expect(screen.getByText(/Across: /)).toBeTruthy();
    expect(screen.queryByText(/Largest/)).toBeNull();
  });

  it('"Answer the setup questions" really resets the profile back to first run', async () => {
    const user = userEvent.setup();
    render(<UnderstandView />);
    await user.click(await screen.findByRole('button', { name: 'Answer the setup questions' }));
    await waitFor(async () => {
      const profile = (await window.neuropause.invoke('xp:profile.get')) as { state: string };
      expect(profile.state).toBe('pending');
    });
  });

  it('the empty state disappears once the person states one thing', async () => {
    const user = userEvent.setup();
    render(<UnderstandView />);
    await user.click(await screen.findByRole('button', { name: 'Add one thing instead' }));
    await user.type(await screen.findByLabelText('Label'), 'Main market');
    await user.type(screen.getByLabelText('Value'), 'Germany');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByText(/You haven.t told NeuroPause anything yet/)).toBeNull(),
    );
    expect(screen.getByText('Germany')).toBeTruthy();
  });
});
