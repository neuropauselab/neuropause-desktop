import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockState = vi.hoisted(() => ({ userDataDir: '' }));
vi.mock('electron', () => ({ app: { getPath: (_n: string) => mockState.userDataDir } }));

import { loadAiConfig, saveAiConfig, DEFAULT_AI_CONFIG } from './aiConfigStore';

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
    expect(Object.keys(saved)).toEqual(['provider', 'model', 'ollamaUrl', 'migratedFromEnv']);
  });
});
