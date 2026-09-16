/**
 * FG-9 · S5.4 Phase 0 — PANEL-LEVEL truthful surface. Proves the WIRING the panel adds: when
 * M365WritePanel receives a `brainReview` prop (the value the propose IPC returns as `response.brainReview`),
 * it MOUNTS the BrainReviewCard and renders the eight review fields VERBATIM above the compose form. And the
 * additive-only contract: absent `brainReview` ⇒ the panel renders NO proposal-review region (behaves as today).
 *
 * brainReviewCard.test.tsx pins the card in isolation; this pins the panel→card wiring specifically — that the
 * prop is threaded through unchanged, never re-derived. Component-level (jsdom).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { clearRoutes } from './setup';
import type { ConnectorSyncSnapshot } from '@neuropause/shared';
import { M365WritePanel } from '@renderer/connectors/M365WritePanel';
import type { BrainReview } from '@renderer/connectors/BrainReviewCard';

beforeEach(() => {
  cleanup();
  clearRoutes();
});
afterEach(() => cleanup());

const review: BrainReview = {
  purpose: 'Reply to the operator with the requested summary',
  target: 'neuropause033@gmail.com',
  action: 'mail.send',
  risk: 'Consequential — one external email',
  evidenceRefs: ['ev-1', 'ev-2'],
  expectedEffect: 'One message appears in Sent Items',
  verificationPlan: 'Read-back Sent Items by internetMessageId',
  expiry: '2026-08-19T12:00:00Z',
};

const snaps: ConnectorSyncSnapshot[] = [];

describe('FG-9 · M365WritePanel → BrainReviewCard wiring (truthful surface)', () => {
  it('renders the eight review fields VERBATIM when brainReview is supplied', () => {
    render(
      <M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={snaps} brainReview={review} />,
    );
    const card = screen.getByLabelText('Proposal review');
    const field = (label: string): string =>
      card.querySelector(`[data-review-field="${label}"]`)?.textContent ?? '';
    // Every displayed value equals its prop VERBATIM — the panel threads it through, never re-derives.
    expect(field('Purpose')).toContain(review.purpose);
    expect(field('Target')).toContain(review.target);
    expect(field('Action')).toContain(review.action);
    expect(field('Risk')).toContain(review.risk);
    expect(field('Evidence')).toContain('ev-1, ev-2');
    expect(field('Expected effect')).toContain(review.expectedEffect);
    expect(field('Verification')).toContain(review.verificationPlan);
    expect(field('Expires')).toContain(review.expiry);
  });

  it('ADDITIVE-ONLY — absent brainReview renders NO proposal-review region (panel as today)', () => {
    render(<M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={snaps} />);
    expect(screen.queryByLabelText('Proposal review')).toBeNull();
    // The compose surface is still present — the panel is otherwise unchanged.
    expect(screen.getByPlaceholderText('To (comma-separated)')).toBeTruthy();
  });

  it('DISPLAY-ONLY — the Verification row shows the plan string, never a re-derived verdict', () => {
    render(
      <M365WritePanel connectorId="microsoft-entra" accountId="acct-1" snaps={snaps} brainReview={review} />,
    );
    const card = screen.getByLabelText('Proposal review');
    const verification = card.querySelector('[data-review-field="Verification"]')?.textContent ?? '';
    expect(verification).toContain('Read-back Sent Items by internetMessageId');
    // It is the artifact's plan, not a live terminal — no success/failure verdict is synthesized here.
    expect(verification).not.toContain('VERIFIED_SUCCESS');
    expect(verification).not.toContain('VERIFY_FAILED');
  });
});
