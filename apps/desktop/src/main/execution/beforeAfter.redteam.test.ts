import { describe, it, expect } from 'vitest';
import { AuditChain } from '../security/auditChain';
import { ExecuteEngine } from '../executeEngine';
import { evaluateAction, DEFAULT_POLICIES } from '../workforce/governance/policyEngine';
import { createExecutionGate } from './executionGovernance';

interface Entry {
  id: string;
  actor: string;
  action: string;
}
const canon = (e: Entry) => JSON.stringify({ id: e.id, actor: e.actor, action: e.action });

describe('BEFORE — what is true without the fixes', () => {
  it('an ungoverned ExecuteEngine dispatches a high-risk action', async () => {
    const ran: string[] = [];
    const engine = new ExecuteEngine({});
    engine.register('connector', async () => {
      ran.push('connector');
      return { ok: true };
    });
    const s = await engine.execute({ kind: 'connector', input: 'send it' });
    expect(ran).toEqual(['connector']);
    expect(s.state).toBe('completed');
  });

  it('a hash-only chain can be forged by anyone who can write both files', () => {
    const chain = new AuditChain<Entry>(canon, 'demo');
    const entries: Entry[] = [];
    for (const e of [
      { id: '1', actor: 'alice', action: 'export' },
      { id: '2', actor: 'alice', action: 'delete' },
    ]) {
      entries.push(e);
      chain.append(e);
    }
    expect(chain.verify(entries).ok).toBe(true);

    // Attacker rewrites an entry AND recomputes the head — both are on disk.
    entries[1] = { id: '2', actor: 'bob', action: 'delete' };
    const forged = new AuditChain<Entry>(canon, 'demo');
    forged.rebuild(entries);

    expect(forged.verify(entries).ok).toBe(true); // forgery verifies clean
  });
});

describe('AFTER — governance on the execution path', () => {
  it('a gated ExecuteEngine refuses the same action and never dispatches', async () => {
    const ran: string[] = [];
    const engine = new ExecuteEngine({
      gate: createExecutionGate({
        evaluate: evaluateAction,
        principal: () => ({ id: 'op', role: 'operations', trustScore: 0, grantedScopes: [] }),
        policies: () => DEFAULT_POLICIES,
      }),
    });
    engine.register('connector', async () => {
      ran.push('connector');
      return { ok: true };
    });
    const s = await engine.execute({ kind: 'connector', input: 'send it' });

    expect(ran).toEqual([]);
    expect(s.state).toBe('failed');
    expect(s.error).toMatch(/governance/i);
  });
});
