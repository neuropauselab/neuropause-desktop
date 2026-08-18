/**
 * Slice-15 conditions 2 + 4 — the first-real-send guard: allowlist on ALL recipient fields, fail-closed parsing, and a
 * durable single-send latch (at-most-once, survives restart). Refusal happens BEFORE the executor by construction (the
 * guard returns a DENIED ConnectorWriteResult; the frozen hook returns it without calling governedSend).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// A temp userData dir the mocked electron app.getPath returns. vi.hoisted lets the vi.mock factory reference it; the
// dir string is built from process.env (no require/import — those aren't available inside the hoisted block).
const USERDATA = vi.hoisted(() => `${process.env.TMPDIR ?? '/tmp'}/np-frsg-${process.pid}`.replace(/\/+/g, '/'));
vi.mock('electron', () => ({ app: { getPath: () => USERDATA } }));

import { firstRealSendGuard } from './firstRealSendGuard';

const LATCH = join(USERDATA, 'first-real-send.latch');
const OP = 'neuropause033@gmail.com';

beforeEach(() => {
  process.env.NEUROPAUSE_FIRST_REAL_SEND = '1';
  mkdirSync(USERDATA, { recursive: true });
  if (existsSync(LATCH)) rmSync(LATCH);
});
afterEach(() => {
  delete process.env.NEUROPAUSE_FIRST_REAL_SEND;
  if (existsSync(LATCH)) rmSync(LATCH);
});

describe('firstRealSendGuard — recipient allowlist (all fields, fail closed)', () => {
  it('the operator address alone → ok, and latches', () => {
    expect(firstRealSendGuard({ to: [OP], subject: 'S', body: 'B' }).ok).toBe(true);
    expect(existsSync(LATCH)).toBe(true);
  });
  it('any other recipient → DENIED, no latch written', () => {
    const r = firstRealSendGuard({ to: ['attacker@evil.com'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.data?.reason).toBe('RECIPIENT_NOT_ALLOWLISTED');
    expect(existsSync(LATCH)).toBe(false);
  });
  it('the operator address PLUS another → DENIED (must be exactly one)', () => {
    expect(firstRealSendGuard({ to: [OP, 'x@y.com'] }).ok).toBe(false);
  });
  it('any cc present → DENIED', () => {
    const r = firstRealSendGuard({ to: [OP], cc: ['x@y.com'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.data?.reason).toBe('CC_BCC_PRESENT');
  });
  it('any bcc present → DENIED', () => {
    expect(firstRealSendGuard({ to: [OP], bcc: ['x@y.com'] }).ok).toBe(false);
  });
  it('unparseable / missing recipients → DENIED (fail closed)', () => {
    expect(firstRealSendGuard({ to: 'not-an-array' }).ok).toBe(false);
    expect(firstRealSendGuard(null).ok).toBe(false);
    expect(firstRealSendGuard({}).ok).toBe(false);
    expect(firstRealSendGuard({ to: [] }).ok).toBe(false);
  });
  it('matches the operator address case-insensitively', () => {
    expect(firstRealSendGuard({ to: ['NeuroPause033@Gmail.com'] }).ok).toBe(true);
  });
});

describe('firstRealSendGuard — single-send latch (at-most-once, survives restart)', () => {
  it('the second send is DENIED by the latch, even for the operator address', () => {
    expect(firstRealSendGuard({ to: [OP] }).ok).toBe(true);
    const r2 = firstRealSendGuard({ to: [OP] });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.refusal.data?.reason).toBe('SINGLE_SEND_LATCH');
  });
  it('the latch is a durable file — a fresh call (i.e. a restart) still refuses', () => {
    firstRealSendGuard({ to: [OP] });
    expect(existsSync(LATCH)).toBe(true);
    expect(firstRealSendGuard({ to: [OP] }).ok).toBe(false); // fresh call sees the persisted latch
  });
});

describe('firstRealSendGuard — inert when the mode is off', () => {
  it('returns ok for ANY recipient and never writes the latch when NEUROPAUSE_FIRST_REAL_SEND is unset', () => {
    delete process.env.NEUROPAUSE_FIRST_REAL_SEND;
    expect(firstRealSendGuard({ to: ['anyone@anywhere.com'], cc: ['also@x.com'] }).ok).toBe(true);
    expect(existsSync(LATCH)).toBe(false);
  });
});
