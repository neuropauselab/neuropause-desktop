/**
 * ConnectionValidator — validates a candidate AI configuration WITHOUT persisting
 * it, so the Settings "Test" button can check a key or a local server before the
 * user commits. It is the single owner of "is this provider reachable / is this key
 * valid". The secret is used only to make the check and is never logged or returned.
 *
 * Claude: a GET /v1/models with the key (cheap, no completion cost) — 200 ⇒ valid,
 * 401 ⇒ bad key. Ollama: a GET /api/tags reachability probe.
 */
import type { AiTestResultDto } from '@neuropause/shared';

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
const ANTHROPIC_VERSION = '2023-06-01';

async function timeBoxed<T>(ms: number, run: (signal: AbortSignal) => Promise<T>, onAbortOrError: () => T): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch {
    return onAbortOrError();
  } finally {
    clearTimeout(timer);
  }
}

/** Validate an Anthropic API key by listing models. The key is never logged. */
export async function validateClaudeKey(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<AiTestResultDto> {
  if (!apiKey) return { ok: false, detail: 'No API key provided.', latencyMs: null };
  const started = Date.now();
  return timeBoxed(
    8000,
    async (signal) => {
      const res = await fetchImpl(ANTHROPIC_MODELS_URL, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        signal,
      });
      const latencyMs = Date.now() - started;
      if (res.ok) return { ok: true, detail: 'Anthropic API key is valid.', latencyMs };
      if (res.status === 401) return { ok: false, detail: 'Invalid API key (401 Unauthorized).', latencyMs };
      return { ok: false, detail: `Anthropic API returned HTTP ${res.status}.`, latencyMs };
    },
    () => ({ ok: false, detail: 'Could not reach the Anthropic API.', latencyMs: Date.now() - started }),
  );
}

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

/** Validate an OpenAI API key by listing models. The key is never logged. */
export async function validateOpenAiKey(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<AiTestResultDto> {
  if (!apiKey) return { ok: false, detail: 'No API key provided.', latencyMs: null };
  const started = Date.now();
  return timeBoxed(
    8000,
    async (signal) => {
      const res = await fetchImpl(OPENAI_MODELS_URL, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal,
      });
      const latencyMs = Date.now() - started;
      if (res.ok) return { ok: true, detail: 'OpenAI API key is valid.', latencyMs };
      if (res.status === 401) return { ok: false, detail: 'Invalid API key (401 Unauthorized).', latencyMs };
      if (res.status === 429) return { ok: false, detail: 'Rate limited by OpenAI (429). Try again shortly.', latencyMs };
      return { ok: false, detail: `OpenAI API returned HTTP ${res.status}.`, latencyMs };
    },
    () => ({ ok: false, detail: 'Could not reach the OpenAI API.', latencyMs: Date.now() - started }),
  );
}

/** Validate a local Ollama server by probing its tags endpoint. */
export async function validateOllama(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<AiTestResultDto> {
  const started = Date.now();
  return timeBoxed(
    2500,
    async (signal) => {
      const res = await fetchImpl(`${baseUrl}/api/tags`, { signal });
      const latencyMs = Date.now() - started;
      return res.ok
        ? { ok: true, detail: 'Ollama is reachable.', latencyMs }
        : { ok: false, detail: `Ollama returned HTTP ${res.status}.`, latencyMs };
    },
    () => ({ ok: false, detail: `Could not reach Ollama at ${baseUrl}.`, latencyMs: Date.now() - started }),
  );
}
