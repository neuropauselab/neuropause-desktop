/**
 * AI settings panel (M7). Replaces the old read-only "Deployment-managed" row with
 * an in-app surface to choose the provider, enter/store an Anthropic key (in the OS
 * keychain via the main process — the key never comes back to the renderer), pick a
 * model, test the connection, and detect a local Ollama server. All state changes go
 * through ipc.aiConfig (M5/M6); the engine hot-reloads with no restart.
 */
import { useEffect, useState } from 'react';
import type {
  AiConfigDto,
  AiHealthDto,
  AiProviderId,
  AiTestResultDto,
  MigrationStatusDto,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { Button } from '@renderer/components/ui/Button';

const log = createLogger('ai-settings');

const inputCls =
  'app-no-drag h-9 w-full rounded-lg border border-[var(--hairline)] bg-black/20 px-3 text-xs outline-none transition placeholder:text-faint focus:border-accent/60 focus:ring-2 focus:ring-accent/25';
const dot = (s: AiHealthDto['status']): string =>
  s === 'ok' ? 'bg-emerald-400' : s === 'degraded' ? 'bg-amber-400' : s === 'down' ? 'bg-red-400' : 'bg-muted';

export function AiSettingsPanel(): JSX.Element {
  const [cfg, setCfg] = useState<AiConfigDto | null>(null);
  const [health, setHealth] = useState<AiHealthDto | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [ollama, setOllama] = useState<{ reachable: boolean; models: string[] } | null>(null);
  const [test, setTest] = useState<AiTestResultDto | null>(null);
  const [migration, setMigration] = useState<MigrationStatusDto | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    try {
      const c = await ipc.aiConfig.get();
      setCfg(c);
      setModelInput(c.model ?? '');
      setHealth(await ipc.aiConfig.health());
      setMigration(await ipc.aiConfig.migrationStatus());
    } catch (err) {
      log.warn('AI config load failed', err);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const withBusy = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setTest(null);
    try {
      await fn();
    } catch (err) {
      log.warn('AI settings action failed', err);
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return <div className="px-3.5 py-3 text-2xs text-faint">Loading AI configuration…</div>;

  const provider = cfg.provider;
  const chooseProvider = (p: AiProviderId): Promise<void> =>
    withBusy(async () => {
      setCfg(await ipc.aiConfig.setProvider(p));
      setHealth(await ipc.aiConfig.health());
    });
  const saveKey = (): Promise<void> =>
    withBusy(async () => {
      if (!keyInput.trim()) return;
      setCfg(await ipc.aiConfig.setCredential(keyInput.trim()));
      setKeyInput('');
      setHealth(await ipc.aiConfig.health());
    });
  const clearKey = (): Promise<void> =>
    withBusy(async () => {
      setCfg(await ipc.aiConfig.clearCredential());
      setHealth(await ipc.aiConfig.health());
    });
  const saveModel = (): Promise<void> =>
    withBusy(async () => {
      setCfg(await ipc.aiConfig.setModel(modelInput.trim()));
    });
  const runTest = (): Promise<void> =>
    withBusy(async () => {
      setTest(await ipc.aiConfig.test(provider, keyInput.trim() || undefined));
    });
  const detect = (): Promise<void> =>
    withBusy(async () => {
      setOllama(await ipc.aiConfig.detectOllama());
    });
  const importEnv = (): Promise<void> =>
    withBusy(async () => {
      await ipc.aiConfig.migrate();
      await refresh();
    });
  const resetEnv = (): Promise<void> =>
    withBusy(async () => {
      await ipc.aiConfig.resetToEnv();
      setKeyInput('');
      await refresh();
    });

  return (
    <div className="px-3.5 py-3">
      {migration?.available ? (
        <div className="mb-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-2xs">
          <div className="mb-1.5 text-ink">
            Environment AI configuration detected. Import it into editable settings so you can manage it
            here and later drop the environment variables.
          </div>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void importEnv()}>
            Import from environment
          </Button>
        </div>
      ) : null}
      {/* Provider selector */}
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-medium">AI provider &amp; model</div>
        {health ? (
          <span className="flex items-center gap-1.5 text-2xs text-faint">
            <span className={`h-1.5 w-1.5 rounded-full ${dot(health.status)}`} />
            {health.detail}
          </span>
        ) : null}
      </div>

      <div className="mb-3 flex gap-2" role="tablist" aria-label="AI provider">
        {(['claude', 'ollama'] as AiProviderId[]).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={provider === p}
            disabled={busy}
            onClick={() => void chooseProvider(p)}
            className={`app-no-drag rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
              provider === p
                ? 'border-accent/60 bg-accent/15 text-ink'
                : 'border-[var(--hairline)] text-muted hover:bg-white/5'
            }`}
          >
            {p === 'claude' ? 'Anthropic (Claude)' : 'Local (Ollama)'}
          </button>
        ))}
      </div>

      {/* Claude: API key management */}
      {provider === 'claude' ? (
        <div className="mb-3 space-y-2">
          <div className="text-2xs text-faint">
            {cfg.hasStoredKey
              ? 'An Anthropic API key is stored securely in your OS keychain.'
              : 'Add your Anthropic API key to enable cloud AI. It is stored in your OS keychain and never leaves this device except to call Anthropic.'}
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              placeholder={cfg.hasStoredKey ? 'Replace stored key (sk-…)' : 'sk-…'}
              value={keyInput}
              disabled={busy}
              onChange={(e) => setKeyInput(e.target.value)}
              className={inputCls}
            />
            <Button variant="primary" size="sm" disabled={busy || !keyInput.trim()} onClick={() => void saveKey()}>
              Save
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void runTest()}>
              Test connection
            </Button>
            {cfg.hasStoredKey ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void clearKey()}>
                Remove key
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        /* Ollama: detect local server */
        <div className="mb-3 space-y-2">
          <div className="text-2xs text-faint">
            Run models fully on-device with Ollama. Start it with <code>ollama serve</code>, then detect it here.
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void detect()}>
              Detect Ollama
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void runTest()}>
              Test connection
            </Button>
          </div>
          {ollama ? (
            <div className="text-2xs text-faint">
              {ollama.reachable
                ? `Reachable · ${ollama.models.length} model(s): ${ollama.models.join(', ') || '—'}`
                : 'Not reachable — is Ollama running?'}
            </div>
          ) : null}
        </div>
      )}

      {/* Model override */}
      <div className="mb-1 flex gap-2">
        <input
          type="text"
          placeholder={provider === 'ollama' ? 'Model tag (e.g. llama3.1)' : 'Model override (optional)'}
          value={modelInput}
          disabled={busy}
          onChange={(e) => setModelInput(e.target.value)}
          className={inputCls}
        />
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void saveModel()}>
          Set model
        </Button>
      </div>

      {/* Test result */}
      {test ? (
        <div className={`mt-2 text-2xs ${test.ok ? 'text-emerald-400' : 'text-red-400'}`} role="status">
          {test.ok ? '✓ ' : '✕ '}
          {test.detail}
          {test.latencyMs != null ? ` (${test.latencyMs} ms)` : ''}
        </div>
      ) : null}

      <div className="mt-3 border-t border-[var(--hairline)] pt-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void resetEnv()}
          className="app-no-drag text-2xs text-faint underline-offset-2 transition hover:underline disabled:opacity-50"
        >
          Reset AI settings to environment defaults
        </button>
      </div>
    </div>
  );
}
