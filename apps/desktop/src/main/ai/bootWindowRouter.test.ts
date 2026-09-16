/**
 * P13C ROUND 35 — D-4. THE BOOT WINDOW IS FAIL-CLOSED, NOT FAIL-OPEN.
 *
 * The engine singleton exists before the config file, the Secure Vault, the
 * consent flag, or the tenant preference can be read. The old boot router was a
 * bare env-keyed cloud client, so a request in that window — or after a failed
 * reconfigure, forever — routed externally with no mode, no consent, and no
 * tenant policy. These tests prove the window now takes the engine's EXISTING
 * deterministic-fallback path (fail-closed via the structured architecture, not
 * a hidden error), and that swapping in the real router restores normal
 * behavior unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { AiEngine } from './aiEngine';
import { ModelRouter } from './modelRouter';
import { createBootRouter } from './provider';

const REQ = {
  worker: 'test-worker',
  promptId: 'engineering.summary',
  variables: { subject: 'hello' },
} as const;

function engineOn(router: ModelRouter): { engine: AiEngine; routes: string[] } {
  const routes: string[] = [];
  const engine = new AiEngine({
    router,
    recordRoute: (location) => {
      routes.push(location);
    },
  });
  return { engine, routes };
}

describe('D-4 — the boot router', () => {
  it('is never configured, even with a cloud API key in the environment', () => {
    // The exact condition that made the old boot router dangerous: an env key
    // must not make the pre-init router willing to route.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env-key-present');
    vi.stubEnv('OPENAI_API_KEY', 'sk-env-key-present');
    try {
      const router = createBootRouter();
      expect(router.isConfigured()).toBe(false);
      expect(router.resolve('balanced').client.isConfigured()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('answers a boot-window request with the deterministic fallback — nothing leaves the machine', async () => {
    const { engine, routes } = engineOn(createBootRouter());
    const res = await engine.run(REQ);
    // Fail-closed through the EXISTING structured path: a model-free answer,
    // provenance stamped 'none' — never an external provider, never a guess.
    expect(res.model).toBe('none');
    expect(res.routing?.location).toBe('none');
    expect(res.routing?.provider).toBe('none');
    expect(routes).toEqual(['none']);
  });

  it('cannot make an external call even if complete() is reached directly', async () => {
    // Defense in depth for any future caller that skips the isConfigured check.
    const { client } = createBootRouter().resolve('fast');
    await expect(
      client.complete({ model: 'x', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 1 }),
    ).rejects.toThrow(/still initializing/);
  });

  it('a router swap ends the window — normal routing resumes on the same engine instance', async () => {
    const { engine } = engineOn(createBootRouter());
    expect(engine.isConfigured()).toBe(false);

    // The same mechanism engineManager.reconfigure() uses: setRouter in place.
    const real = new ModelRouter({
      client: {
        provider: 'test-provider',
        isConfigured: () => true,
        complete: async (req) => ({
          id: 'r1',
          model: req.model,
          text: 'real answer',
          inputTokens: 1,
          outputTokens: 1,
        }),
      },
    });
    engine.setRouter(real);
    expect(engine.isConfigured()).toBe(true);
    const res = await engine.run(REQ);
    expect(res.text).toContain('real answer');
    expect(res.model).not.toBe('none');
  });
});
