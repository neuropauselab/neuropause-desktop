import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockState = vi.hoisted(() => ({ userDataDir: '' }));
vi.mock('electron', () => ({ app: { getPath: (_n: string) => mockState.userDataDir } }));

import { loadAiConfig, saveAiConfig, DEFAULT_AI_CONFIG, resolveAiMode } from './aiConfigStore';

const cfgPath = (): string => join(mockState.userDataDir, 'ai-config.json');

beforeEach(async () => {
  mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-aicfg-'));
});
afterEach(async () => {
  await fs.rm(mockState.userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('AiConfigStore', () => {
  it('returns defaults when no file exists', () => {
    expect(loadAiConfig()).toEqual(DEFAULT_AI_CONFIG);
  });

  it('round-trips a saved config', () => {
    saveAiConfig({ provider: 'claude', model: 'claude-x', migratedFromEnv: true });
    expect(loadAiConfig()).toEqual({
      provider: 'claude',
      model: 'claude-x',
      ollamaUrl: null,
      migratedFromEnv: true,
      mode: null,
      externalConsent: false,
    });
  });

  it('merges patches, preserving unrelated fields', () => {
    saveAiConfig({ provider: 'ollama', ollamaUrl: 'http://host:1234' });
    saveAiConfig({ model: 'llama3.1' });
    expect(loadAiConfig()).toEqual({
      provider: 'ollama',
      model: 'llama3.1',
      ollamaUrl: 'http://host:1234',
      migratedFromEnv: false,
      mode: null,
      externalConsent: false,
    });
  });

  it('coerces unknown provider and empty strings to null', () => {
    saveAiConfig({ provider: 'gpt5' as unknown as 'claude', model: '', ollamaUrl: '' });
    expect(loadAiConfig()).toEqual(DEFAULT_AI_CONFIG);
  });

  it('falls back to defaults on a corrupt file', async () => {
    await fs.writeFile(cfgPath(), '{ not valid json', 'utf-8');
    expect(loadAiConfig()).toEqual(DEFAULT_AI_CONFIG);
  });

  it('never persists secrets (schema has no secret field)', () => {
    const saved = saveAiConfig({ provider: 'claude' });
    expect(Object.keys(saved)).toEqual([
      'provider',
      'model',
      'ollamaUrl',
      'migratedFromEnv',
      'mode',
      'externalConsent',
    ]);
  });

  // ── Private-First additions ──
  it('round-trips the AI mode and external consent', () => {
    saveAiConfig({ mode: 'private_first', externalConsent: true });
    expect(loadAiConfig()).toMatchObject({ mode: 'private_first', externalConsent: true });
    saveAiConfig({ mode: 'local_only', externalConsent: false });
    expect(loadAiConfig()).toMatchObject({ mode: 'local_only', externalConsent: false });
  });

  it('coerces an unknown mode to null and non-boolean consent to false', () => {
    saveAiConfig({ mode: 'hyper_cloud' as never, externalConsent: 'yes' as never });
    expect(loadAiConfig()).toMatchObject({ mode: null, externalConsent: false });
  });

  it('resolveAiMode preserves pre-mode behaviour: claude installs resolve external, everything else private_first', () => {
    expect(resolveAiMode(loadAiConfig(), 'claude')).toBe('external');
    expect(resolveAiMode(loadAiConfig(), 'ollama')).toBe('private_first');
    saveAiConfig({ mode: 'local_only' });
    expect(resolveAiMode(loadAiConfig(), 'claude')).toBe('local_only');
  });
});
