/**
 * Phase 8 (RC hardening 8.4) — bounded log tests: serialized appends, size
 * rotation with generation shifting, oldest generation dropped, and the
 * never-throws contract (logging must not take the app down).
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBoundedLog } from './boundedLog';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'np-boundedlog-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createBoundedLog', () => {
  it('appends lines in order with newlines normalized', async () => {
    const path = join(dir, 'app.log');
    const log = createBoundedLog(() => path);
    log.append('first');
    log.append('second\n');
    await log.flush();
    expect(await fs.readFile(path, 'utf8')).toBe('first\nsecond\n');
  });

  it('rotates at the byte cap and shifts generations, dropping the oldest', async () => {
    const path = join(dir, 'audit.log');
    const log = createBoundedLog(() => path, { maxBytes: 20, keep: 2 });
    log.append('AAAAAAAAAA'); // 11 bytes with newline → live
    log.append('BBBBBBBBBB'); // would exceed 20 → rotate, live = B
    log.append('CCCCCCCCCC'); // rotate again: .1(B)→.2, live(B)? no — live(C), .1 = B, .2 = A
    await log.flush();
    expect(await fs.readFile(path, 'utf8')).toBe('CCCCCCCCCC\n');
    expect(await fs.readFile(`${path}.1`, 'utf8')).toBe('BBBBBBBBBB\n');
    expect(await fs.readFile(`${path}.2`, 'utf8')).toBe('AAAAAAAAAA\n');
    // One more rotation drops the oldest generation (A) — keep=2 holds.
    log.append('DDDDDDDDDD');
    await log.flush();
    expect(await fs.readFile(`${path}.2`, 'utf8')).toBe('BBBBBBBBBB\n');
    await expect(fs.access(`${path}.3`)).rejects.toThrow();
  });

  it('never throws — an unwritable path is swallowed, later appends continue', async () => {
    const bad = join(dir, 'not-a-dir-file');
    await fs.writeFile(bad, 'occupied'); // make the "directory" a file
    const log = createBoundedLog(() => join(bad, 'impossible', 'x.log'));
    log.append('lost');
    await expect(log.flush()).resolves.toBeUndefined();
    // Recovers when the path becomes valid.
    const good = join(dir, 'ok.log');
    const log2 = createBoundedLog(() => good);
    log2.append('works');
    await log2.flush();
    expect(await fs.readFile(good, 'utf8')).toBe('works\n');
  });
});
