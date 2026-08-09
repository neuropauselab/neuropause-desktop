/**
 * The Opportunity Center's authorization, pinned.
 *
 * Two of these exist because a future reader will be tempted to "fix" the
 * classification, and one of them would be a real regression.
 *
 * `opportunity:execute` is classified `procurement:read`, which looks wrong at
 * a glance for a channel that writes a record. It is not: a bridge-level RBAC
 * refusal throws BEFORE the handler runs, so classifying it `:manage` would
 * make `insufficient_permission` unreachable for the one flow that most needs a
 * durable, explainable refusal — the whole point of Program 3. The scope is
 * enforced inside the handler instead, twice (the subsystem's own check, then
 * the registry's authorize on the write). The test below states that out loud
 * so changing it requires arguing with the reasoning rather than tidying a
 * table.
 *
 * The other half is plainer: findings ARE purchase orders, restated. They must
 * never become a way to read purchase orders past the permission that guards
 * them.
 */
import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import { RUNTIME_CHANNEL_PERMISSIONS, PUBLIC_CHANNELS, withRuntimeAuthz } from '../ipc/runtimeAuthz';
import { DecisionRecordStore } from '../decisions/decisionService';
import { HoldStore } from '../decisions/holdStore';
import { createHoldRaiser } from '../decisions/raiseHold';
import { OpportunityDecisionStore } from './opportunityDecisionStore';
import { OutcomeRevisionStore } from '../outcomes/outcomeRevisionStore';
import { initOpportunities } from '.';

const CHANNELS = [
  IpcChannel.OpportunityList,
  IpcChannel.OpportunitySetStatus,
  IpcChannel.OpportunityExecute,
  IpcChannel.OutcomeGet,
] as const;

/**
 * The channels the subsystem ACTUALLY registers.
 *
 * Read from the real `initOpportunities` rather than written out by hand: a
 * hand-written list would still pass if someone added a fourth handler and
 * forgot to classify it, which is the exact mistake the fail-closed invariant
 * exists to catch.
 */
function registeredChannels(): string[] {
  const dir = join(tmpdir(), `np-authz-${randomUUID()}`);
  const { handlers } = initOpportunities({
    orders: () => [],
    readCeiling: 5_000,
    decisions: new OpportunityDecisionStore(join(dir, 'o.json')),
    raiseHold: createHoldRaiser({
      holds: new HoldStore(join(dir, 'h.json')),
      decisions: new DecisionRecordStore(join(dir, 'd.json')),
      actor: () => null,
      audit: () => undefined,
    }),
    decisionRecords: new DecisionRecordStore(join(dir, 'd.json')),
    canExecute: () => false,
    heldPermissions: () => [],
    actorLabel: () => 'test',
    actor: () => null,
    rfqModuleAvailable: () => false,
    openRfqFor: () => null,
    createRfq: async () => ({ recordId: 'x', label: 'x' }),
    readRfq: () => null,
    executionFor: () => null,
    outcomeRevisions: new OutcomeRevisionStore(join(dir, 'r.json')),
    audit: () => undefined,
    now: () => '2026-08-09T12:00:00.000Z',
  });
  return handlers.map((h) => h.channel as string);
}

describe('Opportunity Center authorization', () => {
  it('classifies every channel — none can ship unguarded', () => {
    for (const channel of CHANNELS) {
      expect(RUNTIME_CHANNEL_PERMISSIONS[channel], `${channel} is unclassified`).toBeTruthy();
      expect(PUBLIC_CHANNELS.has(channel), `${channel} must not be public`).toBe(false);
      expect(RUNTIME_INVOKABLE_CHANNELS).toContain(channel);
    }
  });

  it('scopes findings to PROCUREMENT, not to intelligence or governance', () => {
    // A finding restates purchase orders. Classifying the read as
    // `intelligence:read` would hand anyone with an analytics scope the
    // supplier names, unit prices and order references it is made of.
    for (const channel of CHANNELS) {
      expect(RUNTIME_CHANNEL_PERMISSIONS[channel]).toMatch(/^procurement:/);
    }
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.OpportunityList]).toBe('procurement:read');
    // The outcome restates the same purchase orders, so it takes the same
    // scope — it must not become a side door onto procurement data.
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.OutcomeGet]).toBe('procurement:read');
  });

  it('requires :manage to change shared state', () => {
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.OpportunitySetStatus]).toBe('procurement:manage');
  });

  it('keeps execute at :read SO THAT the permission refusal can become a hold', () => {
    // Deliberate. See the file header before changing this.
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.OpportunityExecute]).toBe('procurement:read');
  });

  it('classifies every channel the subsystem REGISTERS, not just the ones listed here', () => {
    const registered = registeredChannels();
    // A fourth handler added without a classification fails here rather than
    // at somebody's boot.
    expect(registered.sort()).toEqual([...CHANNELS].sort());
  });

  it('is actually stamped onto the real handler defs, not merely listed in a table', () => {
    // The gap this closes: a channel can sit correctly in the map and still
    // ship unguarded if nothing applies the map to its handler. This mirrors
    // what `runtimeCore` does to the enterprise handler array at composition.
    const stamped = withRuntimeAuthz(
      registeredChannels().map((channel) => ({ channel: channel as (typeof CHANNELS)[number] })),
    );
    expect(stamped).toHaveLength(CHANNELS.length);
    for (const def of stamped) {
      expect(def.requireAuth).toBe(true);
      expect(def.permission).toMatch(/^procurement:/);
    }
  });
});
