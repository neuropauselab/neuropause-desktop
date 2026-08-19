/**
 * FG-9 · S5.2 · BrainReviewCard — truthful-surface tests. Every displayed value equals its prop VERBATIM;
 * the card synthesizes nothing; absent review renders nothing (additive-only fallback).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BrainReviewCard, type BrainReview } from '@renderer/connectors/BrainReviewCard';

afterEach(() => cleanup());

const review: BrainReview = {
  purpose: 'send-email',
  target: 'microsoft-entra / acc / ws-A',
  action: 'mail.send → op@ex.com',
  risk: 'low',
  evidenceRefs: ['action-record:act_1'],
  expectedEffect: 'email left the mailbox',
  verificationPlan: 'send-corroboration (verifyEffect) — NOT delivery',
  expiry: 'expires 2026-08-19T00:01:00Z',
};

describe('FG-9 · BrainReviewCard (truthful surface)', () => {
  it('renders each of the eight review fields VERBATIM from the artifact', () => {
    render(<BrainReviewCard review={review} />);
    for (const v of [review.purpose, review.target, review.action, review.risk, review.expectedEffect, review.verificationPlan, review.expiry]) {
      expect(screen.getByText(v)).toBeTruthy(); // getByText throws if the verbatim value is absent
    }
    expect(screen.getByText('action-record:act_1')).toBeTruthy(); // evidence ref shown verbatim
  });

  it('DISPLAY-ONLY — the Verification row shows the artifact string, never a re-derived verdict', () => {
    render(<BrainReviewCard review={review} />);
    const row = screen.getByText('Verification').parentElement;
    expect(row?.textContent).toContain('send-corroboration (verifyEffect) — NOT delivery');
    expect(row?.textContent).not.toMatch(/VERIFIED_SUCCESS|delivered/); // never synthesizes a stronger claim
  });

  it('ADDITIVE-ONLY FALLBACK — absent review renders nothing (panel behaves exactly as today)', () => {
    const { container } = render(<BrainReviewCard review={null} />);
    expect(container.querySelector('[aria-label="Proposal review"]')).toBeNull();
  });
});
