import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SupportBundleGenerator,
  redactText,
  type SupportBundlePayload,
} from './supportBundle';

describe('redactText', () => {
  it('redacts a bare JWT', () => {
    const jwt = 'eyJhbGciOi.eyJzdWIiOiI1Njc.SflKxwRJSMeKKF2QT4';
    const out = redactText(`session cookie ${jwt} issued`);
    expect(out).not.toContain(jwt);
    expect(out).toContain('[REDACTED_JWT]');
  });

  it('redacts bearer tokens and key/value secrets (no secret survives)', () => {
    const bearer = redactText('Authorization: Bearer abc123.def-456');
    expect(bearer).not.toContain('abc123.def-456');
    expect(bearer).toContain('REDACTED');

    const token = redactText('"access_token": "sk-live-9999"');
    expect(token).not.toContain('sk-live-9999');
    expect(token).toContain('REDACTED');

    const secret = redactText('client_secret=supersecretvalue');
    expect(secret).not.toContain('supersecretvalue');
    expect(secret).toContain('REDACTED');
  });

  it('redacts email addresses', () => {
    expect(redactText('user saurabh@example.com logged in')).toContain('[REDACTED_EMAIL]');
    expect(redactText('user saurabh@example.com logged in')).not.toContain('saurabh@example.com');
  });

  it('leaves ordinary text untouched', () => {
    expect(redactText('worker started with 9 skills')).toBe('worker started with 9 skills');
  });
});

describe('SupportBundleGenerator', () => {
  let root: string;
  let dataDir: string;
  let outDir: string;

  const payload: SupportBundlePayload = {
    build: {
      version: '1.0.0',
      channel: 'stable',
      commit: 'abc1234',
      buildTime: '2026-06-01T00:00:00.000Z',
      platform: 'darwin',
      arch: 'arm64',
      packaged: true,
      runtime: { electron: '30.5.1', node: '20', chrome: '124', v8: '12' },
    },
    diagnostics: { overall: 'ok' },
    modules: [{ name: 'demo', kind: 'app', version: '1.0.0', enabled: true }],
    connectors: [{ id: 'c1', name: 'GitHub', status: 'connected' }],
    plugins: [{ id: 'p1', name: 'Sample' }],
    crashes: [],
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'np-support-'));
    dataDir = join(root, 'data');
    outDir = join(root, 'support');
    await fs.mkdir(join(dataDir, 'logs'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('produces a bundle with the expected contents and redaction manifest', async () => {
    const gen = new SupportBundleGenerator({ dataDir, outDir, collect: async () => payload, now: () => 1_700_000_000_000 });
    const info = await gen.generate();
    expect(info.contents).toContain('versions.json');
    expect(info.contents).toContain('diagnostics.json');
    expect(info.contents).toContain('manifest.json');
    expect(info.redacted.length).toBeGreaterThan(0);
    expect(info.sizeBytes).toBeGreaterThan(0);
  });

  it('scrubs secrets that appear in copied log files', async () => {
    await fs.writeFile(join(dataDir, 'logs', 'app.log'), 'Authorization: Bearer leak-me-please\nuser a@b.com');
    const gen = new SupportBundleGenerator({ dataDir, outDir, collect: async () => payload, now: () => 1_700_000_000_000 });
    const info = await gen.generate();
    const copied = await fs.readFile(join(info.path, 'logs', 'app.log'), 'utf8');
    expect(copied).not.toContain('leak-me-please');
    expect(copied).not.toContain('a@b.com');
    expect(copied).toContain('REDACTED');
  });

  it('never copies the connectors token file from disk', async () => {
    await fs.writeFile(join(dataDir, 'logs', 'connectors.json'), '{"token":"secret"}');
    const gen = new SupportBundleGenerator({ dataDir, outDir, collect: async () => payload, now: () => 1_700_000_000_000 });
    const info = await gen.generate();
    // The only connectors.json present is the redacted names-only one at the root.
    expect(info.contents).not.toContain(join('logs', 'connectors.json'));
    const rootConnectors = await fs.readFile(join(info.path, 'connectors.json'), 'utf8');
    expect(rootConnectors).not.toContain('secret');
  });
});
