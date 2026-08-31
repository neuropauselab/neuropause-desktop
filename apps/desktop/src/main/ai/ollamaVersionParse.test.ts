/**
 * `parseOllamaVersion` — the installed-but-not-running case.
 *
 * THE DEFECT, reproduced on a real machine before the fix: the old parse
 * assumed a single line starting with "ollama version" and stripped that
 * prefix. When the binary is installed but the SERVICE IS DOWN, `ollama
 * --version` really emits two warning lines instead, so nothing was stripped
 * and the whole warning became the "version". Settings rendered:
 *
 *   Installed but not running (vWarning: could not connect to a running
 *   Ollama instance\nWarning: client version is 0.30.7)
 *
 * That is worst precisely where it matters most — the state in which the user
 * needs a clear next step, not diagnostic prose pasted into a version field.
 *
 * The first fix ALSO had a bug these pins now hold: with an optional "is", the
 * word "is" is itself a plausible token, so "ollama version is 0.30.7" parsed
 * as the version "is". The capture must start with a digit.
 */
import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';

// `aiConfigIpc` reads Electron at module scope. Only the surface this pure
// function's module needs is stubbed — nothing about the parser is mocked.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (x: string) => Buffer.from(x, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined },
}));

const { parseOllamaVersion } = await import('./aiConfigIpc');

describe('parseOllamaVersion', () => {
  // Verbatim from `ollama --version` on a machine with the service stopped.
  const SERVICE_DOWN = [
    'Warning: could not connect to a running Ollama instance',
    'Warning: client version is 0.30.7',
  ].join('\n');

  it('reads the version when the SERVICE IS DOWN — the case that was broken', () => {
    expect(parseOllamaVersion(SERVICE_DOWN)).toBe('0.30.7');
  });

  it('never returns warning prose as a version', () => {
    const v = parseOllamaVersion(SERVICE_DOWN) ?? '';
    expect(v).not.toContain('Warning');
    expect(v).not.toContain('\n');
    expect(v.length).toBeLessThan(32);
  });

  it('reads the version when the service is running', () => {
    expect(parseOllamaVersion('ollama version is 0.30.7')).toBe('0.30.7');
  });

  it('does not mistake the word "is" for the version', () => {
    expect(parseOllamaVersion('ollama version is 0.30.7')).not.toBe('is');
  });

  it('reads the older prefix form without "is"', () => {
    expect(parseOllamaVersion('ollama version 0.1.2')).toBe('0.1.2');
  });

  it('tolerates a leading v and trailing punctuation', () => {
    expect(parseOllamaVersion('ollama version is v0.30.7.')).toBe('0.30.7');
  });

  it('returns null rather than guessing when there is no version', () => {
    expect(parseOllamaVersion('command not found')).toBeNull();
    expect(parseOllamaVersion('')).toBeNull();
    expect(parseOllamaVersion('Warning: could not connect')).toBeNull();
  });
});
