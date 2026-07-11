/** AI Sandbox S3 — enterprise scenario spec parser. */
import { describe, expect, it } from 'vitest';
import { parseEnterpriseScenario, isEnterpriseSpec, resolveStepChannel } from '@neuropause/shared';

describe('parseEnterpriseScenario', () => {
  it('rejects non-enterprise specs, bad categories, and empty steps', () => {
    expect(parseEnterpriseScenario({ kind: 'desktop', steps: [] }).ok).toBe(false);
    expect(isEnterpriseSpec({ kind: 'enterprise' })).toBe(true);
    expect(parseEnterpriseScenario({ kind: 'enterprise', category: 'nope', metadata: { title: 'x' }, steps: [{ action: 'wait' }] }).ok).toBe(false);
    expect(parseEnterpriseScenario({ kind: 'enterprise', category: 'crm', metadata: { title: 'x' }, steps: [] }).ok).toBe(false);
    expect(parseEnterpriseScenario({ kind: 'enterprise', category: 'crm', metadata: {}, steps: [{ action: 'wait' }] }).ok).toBe(false);
  });

  it('rejects unknown actions, channels, and assertion types', () => {
    expect(parseEnterpriseScenario({ kind: 'enterprise', category: 'crm', metadata: { title: 'x' }, steps: [{ action: 'bogus' }] }).ok).toBe(false);
    expect(parseEnterpriseScenario({ kind: 'enterprise', category: 'crm', metadata: { title: 'x' }, steps: [{ action: 'wait', channel: 'ftp' }] }).ok).toBe(false);
    expect(parseEnterpriseScenario({ kind: 'enterprise', category: 'crm', metadata: { title: 'x' }, steps: [{ action: 'wait', assert: [{ type: 'nope' }] }] }).ok).toBe(false);
  });

  it('rejects duplicate step ids and unresolved dependencies', () => {
    expect(parseEnterpriseScenario({ kind: 'enterprise', category: 'crm', metadata: { title: 'x' }, steps: [{ id: 'a', action: 'wait' }, { id: 'a', action: 'wait' }] }).ok).toBe(false);
    expect(parseEnterpriseScenario({ kind: 'enterprise', category: 'crm', metadata: { title: 'x' }, steps: [{ id: 'a', action: 'wait', dependsOn: ['ghost'] }] }).ok).toBe(false);
  });

  it('normalizes a valid scenario with defaults', () => {
    const r = parseEnterpriseScenario({
      kind: 'enterprise',
      category: 'procurement',
      metadata: { title: 'P2P', description: 'procure to pay' },
      steps: [
        { id: 's1', action: 'createCustomer', input: { name: 'Acme' }, saveAs: 'cust' },
        { id: 's2', action: 'createPurchaseOrder', dependsOn: ['s1'], assert: [{ type: 'recordExists', moduleId: 'procurement-orders', target: '${po}' }] },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.category).toBe('procurement');
      expect(r.value.timeoutMs).toBe(120_000);
      expect(r.value.retry.maxAttempts).toBe(1);
      expect(r.value.steps).toHaveLength(2);
      expect(r.value.steps[0].saveAs).toBe('cust');
      expect(r.value.defaultChannel).toBe('auto');
    }
  });

  it('resolves the channel for a step (explicit → scenario default → action default)', () => {
    expect(resolveStepChannel({ id: 'x', action: 'createCustomer' }, 'auto')).toBe('module');
    expect(resolveStepChannel({ id: 'x', action: 'runMrp' }, 'auto')).toBe('planning');
    expect(resolveStepChannel({ id: 'x', action: 'createCustomer', channel: 'rest' }, 'auto')).toBe('rest');
    expect(resolveStepChannel({ id: 'x', action: 'createCustomer' }, 'sdk')).toBe('sdk');
  });

  it('honors retry policy + approval requirements', () => {
    const r = parseEnterpriseScenario({
      kind: 'enterprise', category: 'finance', metadata: { title: 'AP' },
      retry: { maxAttempts: 3, backoffMs: 10, onExhausted: 'skip' },
      approval: { required: true, permission: 'finance:manage' },
      steps: [{ action: 'createInvoice' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.retry).toMatchObject({ maxAttempts: 3, onExhausted: 'skip' });
      expect(r.value.approval).toMatchObject({ required: true, permission: 'finance:manage' });
      expect(r.value.steps[0].retry?.maxAttempts).toBe(3); // inherits scenario default
    }
  });
});
