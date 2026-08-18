/**
 * Wave-2 Slice-13 — the assistant→panel hand-off mailbox is consumed EXACTLY ONCE (amendment 3).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setPendingMailProposal, consumePendingMailProposal, peekPendingMailProposal, type PendingMailIntent } from './m365ProposalHandoff';

const intent: PendingMailIntent = { to: ['a@b.com'], subject: 'S', body: 'B' };

afterEach(() => {
  // drain any residue so tests don't leak state into each other
  consumePendingMailProposal();
});

describe('m365ProposalHandoff', () => {
  it('read-and-clear: the first consume returns the value, the second returns null', () => {
    setPendingMailProposal(intent);
    expect(consumePendingMailProposal()).toEqual(intent);
    expect(consumePendingMailProposal()).toBeNull();
  });

  it('peek does not clear', () => {
    setPendingMailProposal(intent);
    expect(peekPendingMailProposal()).toEqual(intent);
    expect(peekPendingMailProposal()).toEqual(intent);
    expect(consumePendingMailProposal()).toEqual(intent);
    expect(peekPendingMailProposal()).toBeNull();
  });

  it('a later set overwrites — at most one pending proposal exists at a time', () => {
    setPendingMailProposal(intent);
    setPendingMailProposal({ to: ['c@d.com'], subject: 'S2', body: 'B2' });
    expect(consumePendingMailProposal()).toEqual({ to: ['c@d.com'], subject: 'S2', body: 'B2' });
    expect(consumePendingMailProposal()).toBeNull();
  });

  it('stores a copy — mutating the caller\'s array does not change the pending value', () => {
    const src: PendingMailIntent = { to: ['x@y.com'], subject: 'S', body: 'B' };
    setPendingMailProposal(src);
    src.to.push('injected@evil.com');
    expect(consumePendingMailProposal()?.to).toEqual(['x@y.com']);
  });
});
