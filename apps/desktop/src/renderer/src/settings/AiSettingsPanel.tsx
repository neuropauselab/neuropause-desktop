/**
 * AI settings panel (M7; providers extended in P13C round 34). An in-app surface
 * to choose the provider (Anthropic, OpenAI, or local Ollama), enter/store cloud
 * API keys (in the OS keychain via the main process — a key never comes back to
 * the renderer), pick a model, test the connection, and manage the local Ollama
 * runtime: detect installation vs service, list models, and pull a model after
 * explicit user approval. All state changes go through ipc.aiConfig; the engine
 * hot-reloads with no restart.
 *
 * Round 34 also fixed this panel's oldest defect: `withBusy` used to swallow
 * every failure into `log.warn`, so a permission refusal on Save/Test/Detect
 * was a silent no-op — the exact D-5 class the routing panel documents. Errors
 * now land in a `role="alert"` banner, verbatim.
 */
import { useEffect, useState } from 'react';
import type {
  AiConfigDto,
  AiHealthDto,
  AiProviderId,
  AiTestResultDto,
  MigrationStatusDto,
  OllamaDetectDto,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { Button } from '@renderer/components/ui/Button';

const log = createLogger('ai-settings');

const inputCls =
  'app-no-drag h-9 w-full rounded-lg border border-[var(--hairline)] bg-black/20 px-3 text-xs outline-none transition placeholder:text-faint focus:border-accent/60 focus:ring-2 focus:ring-accent/25';
const dot = (s: AiHealthDto['status']): string =>
  s === 'ok' ? 'bg-emerald-400' : s === 'degraded' ? 'bg-amber-400' : s === 'down' ? 'bg-red-400' : 'bg-muted';

const PROVIDER_LABELS: Record<AiProviderId, string> = {
  claude: 'Anthropic (Claude)',
  openai: 'OpenAI',
  ollama: 'Local (Ollama)',
};

/** Suggested local models for the pull action — size shown before any download. */
const SUGGESTED_LOCAL_MODELS: Array<{ tag: string; note: string }> = [
  { tag: 'llama3.2:3b', note: 'lightweight · ~2 GB download' },
  { tag: 'llama3.1', note: 'balanced · ~4.7 GB download' },
  { tag: 'qwen2.5:14b', note: 'advanced · ~9 GB download' },
];

export function AiSettingsPanel(): JSX.Element {
  const [cfg, setCfg] = useState<AiConfigDto | null>(null);
  const [health, setHealth] = useState<AiHealthDto | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [ollama, setOllama] = useState<OllamaDetectDto | null>(null);
  const [test, setTest] = useState<AiTestResultDto | null>(null);
  const [migration, setMigration] = useState<MigrationStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pullNote, setPullNote] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const c = await ipc.aiConfig.get();
      setCfg(c);
      setModelInput(c.model ?? '');
      setHealth(await ipc.aiConfig.health());
      setMigration(await ipc.aiConfig.migrationStatus());
    } catch (err) {
      log.warn('AI config load failed', err);
      setError(err instanceof Error && err.message ? err.message : 'AI configuration could not be loaded.');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const withBusy = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setTest(null);
    setError(null);
    try {
      await fn();
    } catch (err) {
      // The boundary message is already user-safe; render it verbatim — a
      // refused mutation must never be a silent no-op.
      log.warn('AI settings action failed', err);
      setError(err instanceof Error && err.message ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return <div className="px-3.5 py-3 text-2xs text-faint">Loading AI configuration…</div>;

  const provider = cfg.provider;
  const cloudProvider: 'claude' | 'openai' | null =
    provider === 'claude' || provider === 'openai' ? provider : null;
  const storedKeyForProvider =
    cloudProvider === 'openai' ? cfg.storedKeys.openai : cloudProvider === 'claude' ? cfg.storedKeys.anthropic : false;

  const chooseProvider = (p: AiProviderId): Promise<void> =>
    withBusy(async () => {
      setCfg(await ipc.aiConfig.setProvider(p));
      setHealth(await ipc.aiConfig.health());
    });
  const saveKey = (): Promise<void> =>
    withBusy(async () => {
      if (!keyInput.trim() || !cloudProvider) return;
      setCfg(await ipc.aiConfig.setCredential(cloudProvider, keyInput.trim()));
      setKeyInput('');
      setHealth(await ipc.aiConfig.health());
    });
  const clearKey = (): Promise<void> =>
    withBusy(async () => {
      if (!cloudProvider) return;
      setCfg(await ipc.aiConfig.clearCredential(cloudProvider));
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
  const pull = (tag: string): Promise<void> =>
    withBusy(async () => {
      setPullNote(`Downloading ${tag} — large models can take several minutes…`);
      const res = await ipc.aiConfig.pullModel(tag);
      setPullNote(res.detail);
      setOllama(await ipc.aiConfig.detectOllama());
      if (!res.ok) setError(res.detail);
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
        {(['ollama', 'claude', 'openai'] as AiProviderId[]).map((p) => (
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
            {PROVIDER_LABELS[p]}
          </button>
        ))}
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-2xs leading-relaxed text-danger"
        >
          {error}
        </div>
      ) : null}

      {cloudProvider ? (
        /* Cloud provider: API key management (per provider, keychain-backed) */
        <div className="mb-3 space-y-2">
          <div className="text-2xs text-faint">
            {storedKeyForProvider
              ? `An ${cloudProvider === 'openai' ? 'OpenAI' : 'Anthropic'} API key is stored securely in your OS keychain.`
              : `Add your ${cloudProvider === 'openai' ? 'OpenAI' : 'Anthropic'} API key to enable cloud AI. It is stored in your OS keychain and never leaves this device except to call ${cloudProvider === 'openai' ? 'OpenAI' : 'Anthropic'}.`}
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              placeholder={storedKeyForProvider ? 'Replace stored key (sk-…)' : 'sk-…'}
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
            {storedKeyForProvider ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void clearKey()}>
                Remove key
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        /* Local AI: installation, service, models — three distinct states */
        <div className="mb-3 space-y-2">
          <div className="text-2xs text-faint">
            Run models fully on-device with Ollama. Local requests never leave this machine.
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void detect()}>
              Check local AI
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void runTest()}>
              Test connection
            </Button>
          </div>
          {ollama ? (
            <div className="space-y-1.5 text-2xs text-faint">
              {ollama.reachable ? (
                <div>
                  <span className="text-emerald-400">Running</span>
                  {ollama.version ? ` · v${ollama.version}` : ''} · {ollama.endpoint} ·{' '}
                  {ollama.models.length > 0 ? `models: ${ollama.models.join(', ')}` : 'no models installed yet'}
                </div>
              ) : ollama.installed ? (
                <div>
                  <span className="text-amber-400">Installed but not running</span>
                  {ollama.version ? ` (v${ollama.version})` : ''} — start it with <code>ollama serve</code>, then
                  check again.
                </div>
              ) : ollama.installed === false ? (
                <div>
                  <span className="text-amber-400">Not installed.</span> Ollama is required for local AI — it runs
                  entirely on this device.{' '}
                  <a
                    href="https://ollama.com/download"
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink underline underline-offset-2"
                  >
                    Get Ollama
                  </a>{' '}
                  (opens the official download page), install it, then check again.
                </div>
              ) : (
                <div>Could not determine the installation state. Check again, or start Ollama manually.</div>
              )}
              {ollama.reachable && ollama.models.length === 0 ? (
                <div className="space-y-1 pt-1">
                  <div>Choose a model to download — the download happens on your approval only:</div>
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {SUGGESTED_LOCAL_MODELS.map((m) => (
                      <Button
                        key={m.tag}
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void pull(m.tag)}
                      >
                        {m.tag} · {m.note}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              {pullNote ? <div role="status">{pullNote}</div> : null}
            </div>
          ) : null}
        </div>
      )}

      {/* Model override */}
      <div className="mb-1 flex gap-2">
        <input
          type="text"
          placeholder={
            provider === 'ollama'
              ? 'Model tag (e.g. llama3.1)'
              : provider === 'openai'
                ? 'Model override (e.g. gpt-4o-mini)'
                : 'Model override (optional)'
          }
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
