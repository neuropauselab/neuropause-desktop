import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { CONNECTORS_VERSION } from './index';

describe('connectors scaffold', () => {
  it('resolves the enterprise runtime + cloud-core', () => {
    const runtime = createEnterpriseRuntime({ clock: new ManualClock(0) });
    expect(typeof runtime.audit().append).toBe('function');
    expect(CONNECTORS_VERSION).toContain('preview');
  });
});
