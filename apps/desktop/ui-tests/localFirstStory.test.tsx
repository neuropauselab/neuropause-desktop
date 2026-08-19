/**
 * S39 · F-S17-1 — the two local-first affordances RECONCILED into one story, pinned.
 *
 * The finding: the onboarding's "Try Free Locally" (the DOOR) and the in-shell `LocalModeBanner` (the STATE)
 * coexisted with independent copy. The reconciliation: one vocabulary module (`localFirst/story.ts`) both
 * surfaces render from, with the CLAIM-PLACEMENT rule — the door never claims where data lives (processing is
 * not yet chosen at the welcome), the state line claims it only where it is derived truth (the local branch).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { LOCAL_FIRST_STORY } from '@renderer/localFirst/story';
import { FIRST_RUN_COPY } from '@renderer/firstRun/experienceModel';
import { LocalModeBanner } from '@renderer/shell/LocalModeBanner';

afterEach(() => cleanup());

describe('S39 · one local-first story (F-S17-1 reconciliation)', () => {
  it('SINGLE SOURCE — the door copy in FIRST_RUN_COPY is the story module value by IDENTITY', () => {
    expect(FIRST_RUN_COPY.primaryCta).toBe(LOCAL_FIRST_STORY.door);
    expect(FIRST_RUN_COPY.supporting).toBe(LOCAL_FIRST_STORY.doorSupporting);
  });

  it('CLAIM PLACEMENT — the door never claims where data lives; the state line does (derived truth only)', () => {
    const doorCopy = `${LOCAL_FIRST_STORY.door} ${LOCAL_FIRST_STORY.doorSupporting}`.toLowerCase();
    expect(doorCopy).not.toContain(LOCAL_FIRST_STORY.claim.toLowerCase());
    expect(LOCAL_FIRST_STORY.stateLine.toLowerCase()).toContain(LOCAL_FIRST_STORY.claim.toLowerCase());
  });

  it('the shared term ties the story: the door names the mode ("Locally") the state line proves ("Working locally")', () => {
    expect(LOCAL_FIRST_STORY.door.toLowerCase()).toContain('locally');
    expect(LOCAL_FIRST_STORY.stateLine.toLowerCase().startsWith('working locally')).toBe(true);
  });

  it('the banner renders the STATE half verbatim from the story, and its connect CTA fires the real path', () => {
    const onConnect = vi.fn();
    render(<LocalModeBanner onConnect={onConnect} />);
    expect(screen.getByRole('status', { name: 'Working locally' }).textContent).toContain(LOCAL_FIRST_STORY.stateLine);
    fireEvent.click(screen.getByRole('button', { name: LOCAL_FIRST_STORY.connectCta }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('honest-copy rule survives the reconciliation — the door still makes no unprovable claim', () => {
    const all = JSON.stringify(FIRST_RUN_COPY).toLowerCase();
    expect(all).not.toContain('no credit card');
    expect(all).not.toContain('100% local');
    expect(all).not.toContain('never leaves your device');
    expect(all).not.toContain('stays on this device'); // the claim lives ONLY in the local-branch state line
  });
});
