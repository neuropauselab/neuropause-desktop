/**
 * A7 — channel attribution on a rejected `invoke`.
 *
 * The value of this module is entirely in what it does NOT disturb: roughly eighty
 * call sites render `err.message`, the error boundaries report `{ message, stack }`,
 * and `retrievalStatus.ipcErrorDetail` reads `err.message` and documents that it is
 * already caller-safe. So most of what follows is preservation, not behaviour.
 */
import { describe, expect, it } from 'vitest';
import {
  attributeIpcChannel,
  describeIpcFailure,
  ipcChannelOf,
  isIpcChannelError,
} from './ipcError';

describe('attributeIpcChannel', () => {
  it('records the channel and reads it back', () => {
    const err = attributeIpcChannel(new Error('Not authorized'), 'memory:semanticRecall');
    expect(ipcChannelOf(err)).toBe('memory:semanticRecall');
  });

  it('returns the same object, with message and stack untouched', () => {
    const original = new Error('Request timed out');
    const stack = original.stack;
    const returned = attributeIpcChannel(original, 'graph:nodes');
    expect(returned).toBe(original);
    expect(returned.message).toBe('Request timed out');
    expect(returned.stack).toBe(stack);
  });

  it('is enumerable, so console.error and devtools surface it unprompted', () => {
    const err = attributeIpcChannel(new Error('nope'), 'unified:query');
    expect(Object.keys(err)).toContain('ipcChannel');
  });

  it('leaves message off the enumerable surface, as Error always has', () => {
    // Guards the claim above: attribution must not make `message` enumerable as a
    // side effect, or anything spreading the error would start duplicating it.
    const err = attributeIpcChannel(new Error('nope'), 'unified:query');
    expect(Object.keys(err)).not.toContain('message');
  });

  it('keeps the first attribution when a value is attributed twice', () => {
    // The innermost frame is the specific one; an outer re-throw must not claim it.
    const err = attributeIpcChannel(new Error('boom'), 'inner:channel');
    attributeIpcChannel(err, 'outer:channel');
    expect(ipcChannelOf(err)).toBe('inner:channel');
  });

  it('refuses to let a later frame overwrite the origin', () => {
    const err = attributeIpcChannel(new Error('boom'), 'auth:login');
    try {
      (err as unknown as Record<string, unknown>).ipcChannel = 'something:else';
    } catch {
      /* strict mode throws on a non-writable assignment; either outcome is fine */
    }
    expect(ipcChannelOf(err)).toBe('auth:login');
  });

  it('passes non-object rejections through unchanged', () => {
    // A handler that throws a string, or a rejection with no value at all, must not
    // become a different failure just because attribution had nowhere to write.
    expect(attributeIpcChannel('plain string', 'a:b')).toBe('plain string');
    expect(attributeIpcChannel(undefined, 'a:b')).toBeUndefined();
    expect(attributeIpcChannel(null, 'a:b')).toBeNull();
  });

  it('leaves a frozen error alone rather than throwing', () => {
    const frozen = Object.freeze(new Error('sealed'));
    expect(() => attributeIpcChannel(frozen, 'a:b')).not.toThrow();
    expect(ipcChannelOf(frozen)).toBeNull();
    expect(frozen.message).toBe('sealed');
  });
});

describe('ipcChannelOf', () => {
  it('is null for anything invoke did not attribute', () => {
    expect(ipcChannelOf(new Error('unrelated'))).toBeNull();
    expect(ipcChannelOf('a string')).toBeNull();
    expect(ipcChannelOf(null)).toBeNull();
    expect(ipcChannelOf(undefined)).toBeNull();
  });

  it('ignores a non-string or empty ipcChannel a foreign object happens to carry', () => {
    expect(ipcChannelOf({ ipcChannel: 42 })).toBeNull();
    expect(ipcChannelOf({ ipcChannel: '' })).toBeNull();
  });
});

describe('isIpcChannelError', () => {
  it('narrows only an Error that carries attribution', () => {
    expect(isIpcChannelError(attributeIpcChannel(new Error('x'), 'a:b'))).toBe(true);
    expect(isIpcChannelError(new Error('x'))).toBe(false);
    // A plain object with the right property is not an Error, and must not pass.
    expect(isIpcChannelError({ ipcChannel: 'a:b', message: 'x' })).toBe(false);
  });
});

describe('describeIpcFailure', () => {
  it('names the attributed channel and the message', () => {
    const err = attributeIpcChannel(new Error('Not authorized'), 'memory:semanticRecall');
    expect(describeIpcFailure(err)).toBe('memory:semanticRecall: Not authorized');
  });

  it('accepts an explicit channel, for the call site that has not attributed yet', () => {
    expect(describeIpcFailure(new Error('Not authorized'), 'graph:nodes')).toBe(
      'graph:nodes: Not authorized',
    );
  });

  it('says so plainly when there is no channel and no message', () => {
    expect(describeIpcFailure(undefined)).toBe('unknown channel: rejected with no message');
    expect(describeIpcFailure(new Error(''), 'a:b')).toBe('a:b: rejected with no message');
  });

  it('uses a string rejection as its own message', () => {
    expect(describeIpcFailure('bridge unavailable', 'a:b')).toBe('a:b: bridge unavailable');
  });
});
