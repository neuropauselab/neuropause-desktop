/**
 * The shared HOLD raiser — the seam every producer outside the enterprise
 * root goes through.
 *
 * Two properties carry the weight, and both are about NOT accumulating junk:
 *
 *  - **Retrying a refused action produces one hold, not five.** A governance
 *    list that fills with duplicates is a list nobody reads, which quietly
 *    removes the whole value of persisting holds in the first place.
 *  - **The Decision Record follows the HOLD's identity, not the call.** A
 *    second record for the same hold would double-count one event in the
 *    reconstruction trail — the trail's only job is to be accurate about what
 *    happened, and twice is not accurate.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { insufficientEvidenceHold, permissionMissingHold } from '@neuropause/shared';
import { DecisionRecordStore } from './decisionService';
import { HoldStore } from './holdStore';
import { createHoldRaiser, type HoldRaiser } from './raiseHold';

describe('createHoldRaiser', () => {
  let dir: string;
  let holds: HoldStore;
  let decisions: DecisionRecordStore;
  let audits: string[];
  let raise: HoldRaiser;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-raise-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    holds = new HoldStore(join(dir, 'h.json'));
    decisions = new DecisionRecordStore(join(dir, 'd.json'));
    await Promise.all([holds.load(), decisions.load()]);
    audits = [];
    raise = createHoldRaiser({
      holds,
      decisions,
      actor: () => 'priya@example.com',
      audit: (action, target) => audits.push(`${action}|${target}`),
    });
  });

  afterEach(async () => {
    await Promise.all([holds.flush(), decisions.flush()]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  const permission = () => ({
    ...permissionMissingHold({
      action: 'posting a journal',
      permission: 'finance:manage',
      heldPermissions: ['finance:read'],
      actorLabel: 'Priya',
    }),
    title: 'Permission needed: finance:manage',
    subject: 'permission/finance:manage',
    requestedAction: 'Post a journal entry',
  });

  it('opens a hold, pairs a Decision Record with it, and audits — one call', () => {
    const hold = raise(permission());
    expect(hold.status).toBe('open');
    expect(hold.actor).toBe('priya@example.com');

    const records = decisions.list();
    expect(records).toHaveLength(1);
    expect(records[0]!.holdId).toBe(hold.id);
    expect(records[0]!.outcome).toBe('cancelled');
    expect(records[0]!.executed).toContain('held');
    expect(audits[0]).toContain('hold.raised');
  });

  it('the record carries the hold’s evidence, not a restatement of it', () => {
    const input = permission();
    raise(input);
    const evidence = decisions.list()[0]!.assessment.evidence.map((e) => e.detail);
    expect(evidence).toEqual([...input.known]);
  });

  it('retrying the same subject yields ONE hold and ONE record', () => {
    const first = raise(permission());
    const second = raise(permission());
    const third = raise(permission());
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(holds.openCount()).toBe(1);
    // The dedupe that matters most: no second record for the same event.
    expect(decisions.count()).toBe(1);
    expect(audits).toHaveLength(1);
  });

  it('a DIFFERENT subject is a different hold', () => {
    raise(permission());
    raise({ ...permission(), subject: 'permission/crm:manage', title: 'Permission needed: crm:manage' });
    expect(holds.openCount()).toBe(2);
    expect(decisions.count()).toBe(2);
  });

  it('a resolved hold does not suppress a genuinely new one for the same subject', () => {
    const first = raise(permission());
    holds.resolve(first.id, 'cancelled', 'Withdrawn.');
    const second = raise(permission());
    expect(second.id).not.toBe(first.id);
    expect(holds.openCount()).toBe(1);
    expect(decisions.count()).toBe(2);
  });

  it('an ABSENCE is recorded as insufficient evidence, not as risk', () => {
    // "You lack a permission" and "this is dangerous" are different claims.
    // Recording a missing scope as high_risk would overstate what is known.
    raise(permission());
    expect(decisions.list()[0]!.assessment.risk).toBe('insufficient_evidence');
  });

  it('survives a restart — hold and record still paired', async () => {
    const hold = raise({
      ...insufficientEvidenceHold({
        objective: 'estimate impact',
        available: [],
        missing: ['No price data.'],
        resolution: 'Import prices.',
      }),
      title: 'Cannot estimate impact',
      subject: 'opportunity/pricing',
      requestedAction: 'Estimate impact',
    });
    await Promise.all([holds.flush(), decisions.flush()]);

    const holds2 = new HoldStore(join(dir, 'h.json'));
    const decisions2 = new DecisionRecordStore(join(dir, 'd.json'));
    await Promise.all([holds2.load(), decisions2.load()]);
    expect(holds2.openCount()).toBe(1);
    expect(decisions2.list()[0]!.holdId).toBe(hold.id);
    expect(holds2.get(hold.id)!.known[0]).toContain('Nothing relevant is present yet');
  });
});
