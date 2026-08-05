import { describe, it, expect } from 'vitest';
import { WORKSPACE_VERSION, createWorkspacePlatform } from './index';

describe('@neuropause/workspace scaffold', () => {
  it('resolves and exposes a preview version', () => {
    expect(WORKSPACE_VERSION).toContain('preview');
    expect(typeof createWorkspacePlatform).toBe('function');
  });
});
