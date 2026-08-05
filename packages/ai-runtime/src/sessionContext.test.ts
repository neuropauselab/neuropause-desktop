import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { ContextManager, ConversationManager } from './context';
import { MemoryManager, InMemoryLongTermMemory, ShortTermMemory } from './memory';
import { SessionManager } from './sessions';

describe('context', () => {
  it('builds a layered context', () => {
    const cm = new ContextManager('production');
    const ctx = cm.build({ organization: { orgId: 'org_1' }, task: { taskId: 't1', goal: 'x' } });
    expect(ctx.runtime.mode).toBe('production');
    expect(ctx.organization?.orgId).toBe('org_1');
    expect(ctx.task?.goal).toBe('x');
  });
  it('conversation tracks history', () => {
    const c = new ConversationManager();
    c.append({ role: 'user', content: 'hi' });
    c.append({ role: 'assistant', content: 'hello' });
    expect(c.history()).toHaveLength(2);
    c.clear();
    expect(c.size()).toBe(0);
  });
});

describe('memory', () => {
  it('session + short-term + provider-agnostic long-term', async () => {
    const mm = new MemoryManager(new InMemoryLongTermMemory(new ManualClock(0)));
    mm.session('s1').set('k', 'v');
    expect(mm.session('s1').get('k')).toBe('v');
    mm.shortTerm.add('a');
    mm.shortTerm.add('b');
    expect(mm.shortTerm.recent()).toEqual(['a', 'b']);
    await mm.longTerm.put('org_1', 'pref', { theme: 'dark' });
    expect(await mm.longTerm.get('org_1', 'pref')).toEqual({ theme: 'dark' });
    expect(await mm.longTerm.query('org_1')).toHaveLength(1);
  });
  it('short-term memory is bounded', () => {
    const stm = new ShortTermMemory(2);
    stm.add('a');
    stm.add('b');
    stm.add('c');
    expect(stm.recent()).toEqual(['b', 'c']);
  });
});

describe('sessions', () => {
  it('creates, resumes, and closes long-running sessions', () => {
    const sm = new SessionManager(new ManualClock(1000));
    const cm = new ContextManager('development');
    const s = sm.create({ actor: 'usr_1', context: cm.build() });
    expect(s.state).toBe('active');
    expect(s.id.startsWith('ses_')).toBe(true);
    sm.get(s.id)?.conversation.append({ role: 'user', content: 'hi' });
    expect(sm.get(s.id)?.conversation.size()).toBe(1);
    sm.close(s.id);
    expect(sm.get(s.id)?.state).toBe('closed');
    expect(sm.active()).toHaveLength(0);
  });
});
