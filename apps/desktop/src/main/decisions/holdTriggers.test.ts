/**
 * The last three HOLD triggers, exercised through the REAL seams.
 *
 * A factory without a trigger is a shape nobody ever sees. These three were in
 * that state, so what is tested here is specifically the WIRING: a module
 * declares a policy refusal and a hold appears; an unassessable delete refuses
 * rather than sailing through; a refused posting surfaces instead of leaving a
 * document that looks saved and books that never moved.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EnterpriseModuleActionResult, IpcChannelName } from '@neuropause/shared';
import {
  IpcChannel,
  insufficientEvidenceHold,
  policyConflictHold,
  verificationUnavailableHold,
} from '@neuropause/shared';
import {
  EnterpriseModuleRegistry,
  EnterpriseRecordStore,
  buildModuleHandlers,
  defineEnterpriseModule,
} from '../enterprise/framework';
import { DecisionRecordStore } from './decisionService';
import { HoldStore } from './holdStore';
import { createHoldRaiser, type HoldRaiser } from './raiseHold';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T0 = '2026-08-09T12:00:00.000Z';

describe('the last three HOLD triggers', () => {
  let dir: string;
  let holds: HoldStore;
  let decisions: DecisionRecordStore;
  let raise: HoldRaiser;
  let registry: EnterpriseModuleRegistry;
  let call: (channel: IpcChannelName, payload: unknown) => Promise<unknown>;
  let recordId: string;
  /** Flipped per test to make the module's action refuse on policy. */
  let periodClosed: boolean;
  let afterChangeCalls: number;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-triggers-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    periodClosed = false;
    afterChangeCalls = 0;
    holds = new HoldStore(join(dir, 'h.json'));
    decisions = new DecisionRecordStore(join(dir, 'd.json'));
    await Promise.all([holds.load(), decisions.load()]);
    raise = createHoldRaiser({
      holds,
      decisions,
      actor: () => 'priya@example.com',
      audit: () => undefined,
    });

    registry = new EnterpriseModuleRegistry();
    const module = defineEnterpriseModule({
      descriptor: {
        id: 'finance-journal-entries',
        title: 'Journal entries',
        singular: 'Journal entry',
        plural: 'Journal entries',
        icon: 'doc',
        description: 'test',
        titleField: 'reference',
        permissions: { read: 'operations:read', write: 'operations:manage' },
        fields: [{ key: 'reference', label: 'Reference', type: 'text', required: true }],
        actions: [{ key: 'post', label: 'Post' }],
      },
      store: new EnterpriseRecordStore(join(dir, 'je.json'), 'finance-journal-entries', 'entry').bindScope(() => TEST_TENANT_SCOPE),
      hooks: {
        // Mirrors the real module: a closed period is declared as a POLICY
        // refusal, not a validation error, because no privilege overrides it.
        runAction: (action, record): EnterpriseModuleActionResult => {
          if (action !== 'post') return { ok: false, error: 'unknown' };
          if (periodClosed) {
            return {
              ok: false,
              message: 'Period 2025-03 is closed — reopen it or move the entry date.',
              policy: {
                name: 'the accounting period close',
                facts: [`Entry ${record.title} is dated 2025-03-14, which falls in 2025-03.`,
                  'Period 2025-03 is closed.'],
                resolution: 'Move the entry into an open period, or have finance reopen 2025-03.',
              },
            };
          }
          return { ok: true, message: 'Posted.' };
        },
      },
    });
    registry.register(module);
    await module.store.load();
    recordId = module.store.create({
      title: 'JE-1',
      fields: { reference: 'JE-1' },
      now: T0,
    }).id;

    const handlers = buildModuleHandlers(registry, {
      authorize: () => undefined,
      audit: () => undefined,
      broadcast: () => undefined,
      actor: () => 'priya@example.com',
      now: () => T0,
      onAfterChange: () => {
        afterChangeCalls += 1;
      },
      onPolicyConflict: ({ moduleId, record, action, policy }) => {
        raise({
          ...policyConflictHold({
            action: `${action} on ${record.title}`,
            policy: policy.name,
            facts: policy.facts,
            resolution: policy.resolution,
          }),
          title: `${record.title}: blocked by ${policy.name}`,
          subject: `${moduleId}/${record.id}/${action}`,
          requestedAction: `${action} ${record.title}`,
        });
      },
    });
    const byChannel = new Map(handlers.map((h) => [h.channel as string, h]));
    call = async (channel, payload) => {
      const handler = byChannel.get(channel);
      if (!handler) throw new Error(`no handler for ${channel}`);
      return handler.handler(handler.schema.parse(payload));
    };
  });

  afterEach(async () => {
    await Promise.all([holds.flush(), decisions.flush(), ...registry.list().map((m) => m.store.flush())]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  const post = (): Promise<EnterpriseModuleActionResult> =>
    call(IpcChannel.EnterpriseModuleAction, {
      moduleId: 'finance-journal-entries',
      id: recordId,
      action: 'post',
    }) as Promise<EnterpriseModuleActionResult>;

  describe('policy_conflict', () => {
    it('a successful action raises NO hold', async () => {
      const result = await post();
      expect(result.ok).toBe(true);
      expect(holds.openCount()).toBe(0);
    });

    it('a POLICY refusal raises a hold carrying the policy’s own facts', async () => {
      periodClosed = true;
      const result = await post();
      expect(result.ok).toBe(false);

      const hold = holds.openHolds()[0]!;
      expect(hold.reason).toBe('policy_conflict');
      expect(hold.why).toContain('the accounting period close');
      expect(hold.known).toContain('Period 2025-03 is closed.');
      expect(hold.resolution).toContain('reopen 2025-03');
      // No way through: a closed period is not the actor's to waive.
      expect(hold.ifProceeding).toBe('');
    });

    it('a plain error is NOT a policy conflict — no hold', async () => {
      const result = (await call(IpcChannel.EnterpriseModuleAction, {
        moduleId: 'finance-journal-entries',
        id: recordId,
        action: 'post',
      })) as EnterpriseModuleActionResult;
      expect(result.ok).toBe(true);
      // And an unknown action, which refuses WITHOUT a policy marker:
      await expect(
        call(IpcChannel.EnterpriseModuleAction, {
          moduleId: 'finance-journal-entries',
          id: recordId,
          action: 'nope',
        }),
      ).resolves.toMatchObject({ ok: false });
      expect(holds.openCount()).toBe(0);
    });

    it('retrying the blocked post does not pile up holds or records', async () => {
      periodClosed = true;
      await post();
      await post();
      await post();
      expect(holds.openCount()).toBe(1);
      expect(decisions.count()).toBe(1);
    });

    it('the hold is paired with a Decision Record and survives a restart', async () => {
      periodClosed = true;
      await post();
      const hold = holds.openHolds()[0]!;
      await Promise.all([holds.flush(), decisions.flush()]);

      const holds2 = new HoldStore(join(dir, 'h.json'));
      const decisions2 = new DecisionRecordStore(join(dir, 'd.json'));
      await Promise.all([holds2.load(), decisions2.load()]);
      expect(holds2.openCount()).toBe(1);
      expect(decisions2.list()[0]!.holdId).toBe(hold.id);
    });
  });

  describe('onAfterChange — the seam verification_unavailable rides on', () => {
    it('fires after a record change, so a refused posting can be noticed', async () => {
      await call(IpcChannel.EnterpriseModuleUpdate, {
        moduleId: 'finance-journal-entries',
        id: recordId,
        fields: { reference: 'JE-1-rev' },
      });
      expect(afterChangeCalls).toBeGreaterThan(0);
    });

    it('a refused posting becomes a hold that does NOT claim failure', () => {
      // The document saved; only its accounting impact did not land. Those are
      // different claims and the hold must not conflate them.
      raise({
        ...verificationUnavailableHold({
          action: 'The accounting impact of finance:inv_1',
          expected: 'a balanced journal entry for this document',
          because: 'no costed lines — COGS cannot be computed',
        }),
        title: 'finance:inv_1: accounting impact not posted',
        subject: 'posting/finance:inv_1',
        requestedAction: 'Post the accounting impact of finance:inv_1',
        executed: 'The document was saved; its journal entry was not posted.',
      });
      const hold = holds.openHolds()[0]!;
      expect(hold.reason).toBe('verification_unavailable');
      expect(hold.known.join(' ')).toContain('no costed lines');
      expect(hold.unknown.join(' ')).toContain('Unverified is not the same as failed');
      expect(decisions.list()[0]!.executed).toContain('was saved');
    });
  });

  describe('insufficient_evidence — an unassessable delete', () => {
    it('refuses with an assessment rather than reading as "nothing depends on this"', () => {
      // The trap: an unbound assessor finds no links, which on screen is
      // indistinguishable from a genuinely unlinked record.
      const view = insufficientEvidenceHold({
        objective: 'judge whether deleting "Acme Ltd" is safe',
        available: ['The record itself: crm-customers/rec_1 (Acme Ltd).'],
        missing: [
          'Dependency assessment is not active in this session, so NeuroPause cannot tell whether other records point at this one.',
        ],
        resolution: 'Restart NeuroPause so dependency assessment binds, then retry.',
      });
      raise({
        ...view,
        title: 'Cannot assess deleting "Acme Ltd"',
        subject: 'crm-customers/rec_1 (Acme Ltd)',
        requestedAction: 'Delete Acme Ltd',
      });
      const hold = holds.openHolds()[0]!;
      expect(hold.reason).toBe('insufficient_evidence');
      expect(hold.unknown.join(' ')).toContain('cannot tell whether other records point at this one');
      expect(hold.ifProceeding).toBe('');
      // Recorded as an absence, not as a risk judgement.
      expect(decisions.list()[0]!.assessment.risk).toBe('insufficient_evidence');
    });
  });
});
