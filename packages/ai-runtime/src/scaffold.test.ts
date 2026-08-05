import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { AI_RUNTIME_VERSION } from './index';

describe('ai-runtime scaffold', () => {
  it('resolves the enterprise runtime + cloud-core', () => {
    const runtime = createEnterpriseRuntime({ clock: new ManualClock(0) });
    expect(runtime.version).toContain('preview');
    expect(typeof runtime.events().publish).toBe('function');
    expect(AI_RUNTIME_VERSION).toContain('preview');
  });
});
