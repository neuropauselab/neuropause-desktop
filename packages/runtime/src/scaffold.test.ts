import { describe, it, expect } from 'vitest';
import { EventBus, InMemoryEventStore, ManualClock } from '@neuropause/cloud-core';
import { RUNTIME_VERSION } from './index';

describe('runtime scaffold', () => {
  it('resolves cloud-core and exposes a version', () => {
    const bus = new EventBus(new InMemoryEventStore(), new ManualClock(0));
    expect(bus.stats().published).toBe(0);
    expect(RUNTIME_VERSION).toContain('preview');
  });
});
