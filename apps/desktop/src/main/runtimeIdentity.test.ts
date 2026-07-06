import { describe, expect, it, vi } from 'vitest';
import { RuntimeIdentityContext, type RuntimeIdentity } from './runtimeIdentity';

const ID_A = { organizationId: 'org-1', userId: 'user-1', deviceId: 'dev-1' };
const ID_ORG2 = { organizationId: 'org-2', userId: 'user-1', deviceId: 'dev-1' };

describe('RuntimeIdentityContext', () => {
  it('starts empty (not ready, null current)', () => {
    const ctx = new RuntimeIdentityContext();
    expect(ctx.isReady()).toBe(false);
    expect(ctx.getCurrent()).toBeNull();
  });

  it('login initialization: set becomes ready, emits ready, notifies subscribers', () => {
    const ctx = new RuntimeIdentityContext();
    const ready = vi.fn();
    const sub = vi.fn();
    ctx.on('ready', ready);
    ctx.subscribe(sub);
    ctx.set(ID_A);
    expect(ctx.isReady()).toBe(true);
    expect(ctx.getCurrent()).toEqual(ID_A);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(sub).toHaveBeenCalledWith(expect.objectContaining(ID_A));
  });

  it('organization switch: emits changed (not ready) with the new org', () => {
    const ctx = new RuntimeIdentityContext();
    const ready = vi.fn();
    const changed = vi.fn();
    ctx.on('ready', ready);
    ctx.on('changed', changed);
    ctx.set(ID_A);
    ctx.set(ID_ORG2);
    expect(ready).toHaveBeenCalledTimes(1); // only the first set
    expect(changed).toHaveBeenCalledTimes(1);
    expect(ctx.getCurrent()?.organizationId).toBe('org-2');
  });

  it('logout clearing: clears state, emits cleared, notifies with null', () => {
    const ctx = new RuntimeIdentityContext();
    const cleared = vi.fn();
    const sub = vi.fn();
    ctx.on('cleared', cleared);
    ctx.set(ID_A);
    ctx.subscribe(sub);
    ctx.clear();
    expect(ctx.isReady()).toBe(false);
    expect(ctx.getCurrent()).toBeNull();
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(sub).toHaveBeenCalledWith(null);
  });

  it('duplicate update suppression: identical set emits nothing', () => {
    const ctx = new RuntimeIdentityContext();
    const changed = vi.fn();
    const sub = vi.fn();
    ctx.set(ID_A);
    ctx.on('changed', changed);
    ctx.subscribe(sub);
    ctx.set({ ...ID_A }); // same values, new object
    expect(changed).not.toHaveBeenCalled();
    expect(sub).not.toHaveBeenCalled();
  });

  it('clearing when already empty is a no-op (no duplicate cleared)', () => {
    const ctx = new RuntimeIdentityContext();
    const cleared = vi.fn();
    ctx.on('cleared', cleared);
    ctx.clear();
    expect(cleared).not.toHaveBeenCalled();
  });

  it('set after clear emits ready again, not changed', () => {
    const ctx = new RuntimeIdentityContext();
    const ready = vi.fn();
    const changed = vi.fn();
    ctx.on('ready', ready);
    ctx.on('changed', changed);
    ctx.set(ID_A);
    ctx.clear();
    ctx.set(ID_A);
    expect(ready).toHaveBeenCalledTimes(2);
    expect(changed).not.toHaveBeenCalled();
  });

  it('snapshots are immutable (frozen)', () => {
    const ctx = new RuntimeIdentityContext();
    ctx.set(ID_A);
    const snap = ctx.getCurrent() as RuntimeIdentity;
    expect(Object.isFrozen(snap)).toBe(true);
    expect(() => {
      (snap as { organizationId: string }).organizationId = 'hacked';
    }).toThrow();
    expect(ctx.getCurrent()?.organizationId).toBe('org-1');
  });

  it('unsubscribe stops notifications', () => {
    const ctx = new RuntimeIdentityContext();
    const sub = vi.fn();
    const unsub = ctx.subscribe(sub);
    ctx.set(ID_A);
    expect(sub).toHaveBeenCalledTimes(1);
    unsub();
    ctx.set(ID_ORG2);
    expect(sub).toHaveBeenCalledTimes(1); // not called again
  });
});
