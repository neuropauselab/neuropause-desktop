/* eslint-disable no-console */
/**
 * Live smoke test for the AI Engine. This is NOT run by the test suite (which
 * uses a mock); it makes ONE real call through whichever provider is selected so
 * you can verify the engine end-to-end.
 *
 * Local (free, no key) — recommended:
 *   NEUROPAUSE_LLM_PROVIDER=ollama npx tsx src/main/ai/smoke.ts
 *
 * Claude (needs a key + credits):
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx src/main/ai/smoke.ts
 *
 * It prints the provider, the model used, the response, token/cost usage,
 * latency, and the audit record written for the call.
 */
import { createModelRouter, resolveProvider } from './provider';
import { AiEngine } from './aiEngine';

async function main(): Promise<void> {
  const provider = resolveProvider();
  const router = createModelRouter();
  console.log('provider :', provider);
  if (!router.isConfigured()) {
    console.error(
      provider === 'claude'
        ? 'Claude selected but no ANTHROPIC_API_KEY is set.'
        : 'Selected provider is not configured.',
    );
    process.exit(1);
    return;
  }

  const engine = new AiEngine({ router });
  const res = await engine.run({
    worker: 'diagnostic',
    promptId: 'generic.summary',
    tier: 'fast',
    maxOutputTokens: 256,
    context: [
      {
        source: 'mission-brief',
        text: 'CI failing on neurocover-focus@main: 8/8 recent runs failed. Latest release v1.2.0 shipped 14 days ago. No open pull requests.',
        evidence: [{ kind: 'activity', id: 'run-1' }],
      },
    ],
  });

  console.log('grounded :', res.grounded);
  console.log('model    :', res.model);
  console.log('latencyMs:', res.latencyMs);
  console.log('usage    :', res.usage);
  console.log('confidence:', res.confidence);
  console.log('text     :', res.text);
  console.log('parsed   :', JSON.stringify(res.data, null, 2));
  console.log('audit    :', JSON.stringify(engine.audit.recent(1)[0], null, 2));

  if (!res.grounded && provider === 'ollama') {
    console.log('\nHint: make sure Ollama is running and the model is pulled:\n  ollama serve\n  ollama pull llama3.1');
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
