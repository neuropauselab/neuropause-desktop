/**
 * ERP Session 44 — a surfaced held-command HOLD is operator-actionable in the EXISTING Hold Center UI.
 *
 * S44 adds no UI: a crash-orphaned governed command is surfaced as an ordinary `HoldRecord` (built by
 * `buildHeldCommandHoldInput`, exactly as the surfacing service raises it), so the existing `HoldsView`
 * renders it and the existing `HoldResolve` path resolves it. This test proves the operator SEES the
 * ambiguity truthfully — what is known and, crucially, what is NOT known — and that resolving writes a
 * Decision Record. The UI never presents the ambiguous HOLD as successful.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes } from './setup';
import { initDecisions } from '@main/decisions/index';
import { DecisionRecordStore } from '@main/decisions/decisionService';
import { HoldStore } from '@main/decisions/holdStore';
import { buildHeldCommandHoldInput } from '@main/decisions/heldCommandHold';
import { HoldsView } from '@renderer/understanding/HoldsView';

const DIR = join(tmpdir(), 'np-s44-ui');
let dir: string;
let holds: HoldStore;
let decisions: DecisionRecordStore;

beforeEach(async () => {
  dir = join(DIR, randomUUID());
  await fs.mkdir(dir, { recursive: true });
  holds = new HoldStore(join(dir, 'holds.json'));
  decisions = new DecisionRecordStore(join(dir, 'decisions.json'));
  await Promise.all([holds.load(), decisions.load()]);
  const { handlers } = initDecisions({
    decisionRecords: decisions, holds,
    assessmentLive: () => true, relationshipsDeclared: () => 0,
    actor: () => 'operator@example.com', audit: () => undefined,
  });
  for (const h of handlers) route(h.channel as string, (p) => h.handler(h.schema.parse(p)));
  route('xp:profile.get', () => ({ attributes: [], summary: null }));
  route('dp:exportable', () => []);
  route('connectors:list', () => []);
});
afterEach(async () => {
  cleanup();
  clearRoutes();
  await Promise.all([holds.flush(), decisions.flush()]);
});

/** Seed exactly what the surfacing service raises: `holds.open(buildHeldCommandHoldInput(intent))`. */
const surfaceHeldCommand = (): ReturnType<HoldStore['open']> =>
  holds.open(buildHeldCommandHoldInput({ idempotencyKey: 'so-create-9f2a', reservedAt: '2026-09-02T12:00:00.000Z', reason: 'reconciliation required after unclean shutdown' }));

describe('S44 · a surfaced held-command hold in the Hold Center', () => {
  it('renders as ON HOLD (never success) and states what is known AND what is NOT known', async () => {
    surfaceHeldCommand();
    render(<HoldsView />);

    expect(await screen.findByText(/Reconcile an interrupted governed command/)).toBeTruthy();
    // It is a governed pause — cannot-verify — not a success and not a failure.
    expect(screen.getByText(/On hold · Cannot verify the outcome/)).toBeTruthy();
    expect(screen.getByText('What I know')).toBeTruthy();
    expect(screen.getByText(/Command reference: so-create-9f2a/)).toBeTruthy();
    // The ambiguity is on screen, in words: the effect's existence is unknown.
    expect(screen.getByText("What I don't know")).toBeTruthy();
    expect(screen.getByText(/whether the underlying business effect/i)).toBeTruthy();
    expect(screen.getByText('What would resolve this')).toBeTruthy();
    // Nothing anywhere claims the command succeeded.
    expect(screen.queryByText(/succeeded|completed successfully|Done/)).toBeNull();
  });

  it('resolving records the operator’s governed decision and writes a Decision Record', async () => {
    const hold = surfaceHeldCommand();
    const user = userEvent.setup();
    render(<HoldsView />);

    await user.click(await screen.findByRole('button', { name: /I took the safer route/ }));
    await waitFor(() => expect(holds.get(hold.id)?.status).toBe('resolved'));
    expect(holds.get(hold.id)?.resolvedOutcome).toBe('took_alternative');
    // the decision trail shows the resolution.
    expect(await screen.findByText(/Resolve hold: Reconcile an interrupted governed command/)).toBeTruthy();
  });
});
