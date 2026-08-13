import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AutomationRule } from '@neuropause/shared';
import { AutomationStore } from './automationStore';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'auto:1',
    name: 'Summarize investor email to Notion',
    trigger: { type: 'connector-event', connectorId: 'gmail', event: 'message.received' },
    conditions: [{ field: 'from', operator: 'contains', value: 'investor' }],
    conditionLogic: 'all',
    actions: [{ id: 'a1', type: 'ai-summarize', label: 'Summarize with AI' }],
    status: 'active',
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...over,
  };
}

describe('AutomationStore', () => {
  let dir: string;
  let store: AutomationStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'np-auto-'));
    store = new AutomationStore(join(dir, 'automations.json')).bindScope(() => TEST_TENANT_SCOPE);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('saves and reads back a valid rule', async () => {
    const res = await store.save(rule());
    expect(res.ok).toBe(true);
    expect(store.all()).toHaveLength(1);
    expect(store.get('auto:1')?.name).toContain('investor');
  });

  it('rejects an invalid rule with issues, without persisting', async () => {
    const res = await store.save(rule({ name: '  ', actions: [] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.length).toBeGreaterThan(0);
    expect(store.all()).toHaveLength(0);
  });

  it('updates status', async () => {
    await store.save(rule());
    const updated = await store.setStatus('auto:1', 'paused', new Date().toISOString());
    expect(updated?.status).toBe('paused');
    expect(store.summary().paused).toBe(1);
  });

  it('setStatus returns null for unknown id', async () => {
    expect(await store.setStatus('nope', 'paused', new Date().toISOString())).toBeNull();
  });

  it('removes a rule', async () => {
    await store.save(rule());
    expect(await store.remove('auto:1')).toBe(true);
    expect(store.all()).toHaveLength(0);
    expect(await store.remove('auto:1')).toBe(false);
  });

  it('summary counts by status', async () => {
    await store.save(rule({ id: 'auto:1', status: 'active' }));
    await store.save(rule({ id: 'auto:2', status: 'paused' }));
    await store.save(rule({ id: 'auto:3', status: 'draft', name: 'Draft one' }));
    const s = store.summary();
    expect(s.total).toBe(3);
    expect(s.active).toBe(1);
    expect(s.paused).toBe(1);
    expect(s.draft).toBe(1);
  });

  it('persists across instances', async () => {
    await store.save(rule());
    const reopened = new AutomationStore(join(dir, 'automations.json')).bindScope(() => TEST_TENANT_SCOPE);
    expect(reopened.all()).toHaveLength(1);
  });
});
