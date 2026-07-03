import { describe, it, expect } from 'vitest';
import {
  runtimeEventToPlatform,
  downloadEventToPlatform,
  pluginEventToPlatform,
  authStatusToPlatform,
  build,
} from './producers';
import type { RuntimeEvent, NpsProgressEvent, PluginHostEvent, AuthStatus } from '@neuropause/shared';

const rt = (over: Partial<RuntimeEvent>): RuntimeEvent => ({
  type: 'lifecycle', instanceId: 'i1', appSlug: 'figma', status: 'running',
  health: null, message: null, at: '2026-01-01T00:00:00.000Z', ...over,
});

describe('runtimeEventToPlatform', () => {
  it('maps a crash to runtime.crashed at high priority', () => {
    const p = runtimeEventToPlatform(rt({ type: 'crash', status: null }));
    expect(p?.type).toBe('runtime.crashed');
    expect(p?.priority).toBe('high');
  });
  it('maps a running lifecycle to runtime.started', () => {
    expect(runtimeEventToPlatform(rt({ type: 'lifecycle', status: 'running' }))?.type).toBe('runtime.started');
  });
  it('maps a stopped lifecycle to runtime.stopped', () => {
    expect(runtimeEventToPlatform(rt({ type: 'lifecycle', status: 'stopped' }))?.type).toBe('runtime.stopped');
  });
  it('ignores log events', () => {
    expect(runtimeEventToPlatform(rt({ type: 'log' }))).toBeNull();
  });
});

describe('downloadEventToPlatform', () => {
  const dl = (over: Partial<NpsProgressEvent>): NpsProgressEvent => ({
    id: 'op1', appSlug: 'slack', status: 'downloading', progress: 0,
    bytesDownloaded: 0, bytesTotal: 100, message: null, ...over,
  });
  it('emits started → progress → completed across one operation', () => {
    const seen = new Set<string>();
    expect(downloadEventToPlatform(dl({ progress: 0 }), seen)?.type).toBe('download.started');
    expect(downloadEventToPlatform(dl({ progress: 50 }), seen)?.type).toBe('download.progress');
    expect(downloadEventToPlatform(dl({ status: 'completed', progress: 100 }), seen)?.type).toBe('download.completed');
    expect(seen.has('op1')).toBe(false);
  });
  it('maps a failure to download.failed', () => {
    expect(downloadEventToPlatform(dl({ status: 'failed' }), new Set())?.type).toBe('download.failed');
  });
});

describe('pluginEventToPlatform', () => {
  it('surfaces crashes only', () => {
    const crash: PluginHostEvent = { pluginId: 'p1', type: 'crash', status: null, health: null, message: 'x', at: '2026-01-01T00:00:00.000Z' };
    expect(pluginEventToPlatform(crash)?.type).toBe('plugin.crashed');
    expect(pluginEventToPlatform({ ...crash, type: 'log' })).toBeNull();
  });
});

describe('authStatusToPlatform', () => {
  it('detects sign-in and sign-out transitions', () => {
    const authed = { state: 'authenticated', session: {} } as unknown as AuthStatus;
    const anon = { state: 'unauthenticated' } as AuthStatus;
    expect(authStatusToPlatform(authed, false)?.type).toBe('user.signed_in');
    expect(authStatusToPlatform(anon, true)?.type).toBe('user.signed_out');
    expect(authStatusToPlatform(authed, true)).toBeNull();
  });
});

describe('discrete event builders', () => {
  it('produces well-formed events', () => {
    expect(build.appInstalled('figma', 'Figma', '1.0').type).toBe('application.installed');
    expect(build.permissionGranted('figma', 'fs.read').metadata.permission).toBe('fs.read');
    expect(build.updateAvailable('figma', '2.0').category).toBe('update');
    expect(build.workspaceOpened('w1', 'Home').type).toBe('workspace.opened');
  });
});
