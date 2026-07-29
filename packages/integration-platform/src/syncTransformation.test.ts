import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createIntegrationPlatform } from './platform';

describe('E15–E16 — synchronization engine, transformation engine', () => {
  it('sync computes a real diff of added / updated / unchanged / conflict', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    const result = await ip.sync().sync({
      integrationId: 'i1',
      mode: 'incremental',
      source: [{ id: '1', v: 'a' }, { id: '2', v: 'b' }, { id: '3', v: 'c' }],
      target: [{ id: '1', v: 'a' }, { id: '2', v: 'DIFFERENT' }],
      conflictIds: ['2'],
    });
    expect(result.unchanged).toEqual(['1']);
    expect(result.conflicts).toEqual(['2']);
    expect(result.added).toEqual(['3']);
    expect(ip.sync().count()).toBe(1);
  });

  it('the retry queue moves an exhausted record to the dead-letter queue', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    expect(ip.sync().enqueueRetry('r1', 3)).toBe('retry');
    expect(ip.sync().enqueueRetry('r1', 3)).toBe('retry');
    expect(ip.sync().enqueueRetry('r1', 3)).toBe('dead-letter');
    expect(ip.sync().deadLetters()).toContain('r1');
  });

  it('transformation does real JSON↔CSV, field mapping, and validation', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    const csv = ip.transformation().jsonToCsv([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    expect(csv).toBe('a,b\n1,2\n3,4');
    expect(ip.transformation().csvToJson(csv)).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
    expect(ip.transformation().map({ first: '  Bob ' }, [{ from: 'first', to: 'name', transform: 'trim' }])).toEqual({ name: 'Bob' });
    const schema = await ip.transformation().registerSchema({ name: 'contact', requiredFields: ['id', 'email'] });
    expect(ip.transformation().validate(schema.id, { id: '1' }).missing).toEqual(['email']);
  });
});
