/**
 * RC Phase 1 — automation execution integrity.
 *
 * Proves the trust guarantee: an action returns ok:true ONLY when its real
 * subsystem performed the effect. Unavailable subsystems (no AI provider,
 * reminders not wired) fail honestly — never a fabricated success for a no-op.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AiEngineResponse, AutomationAction } from '@neuropause/shared';
import { createActionExecutor, type ActionExecutorDeps } from './automationActions';

const EVENT = { source: 'manual' as const, payload: {} };

function grounded(text = 'ok'): AiEngineResponse {
  return { grounded: true, text } as unknown as AiEngineResponse;
}
function fallback(): AiEngineResponse {
  return { grounded: false, text: '' } as unknown as AiEngineResponse;
}

function act(
  type: AutomationAction['type'],
  config: Record<string, unknown> = {},
): AutomationAction {
  return { id: `a_${type}`, type, label: `${type} action`, config } as AutomationAction;
}

function deps(over: Partial<ActionExecutorDeps> = {}): ActionExecutorDeps {
  return {
    notify: vi.fn(() => ({ ok: true })),
    memory: { remember: vi.fn(() => ({ id: 'mem:test:1' })) },
    ai: { isConfigured: vi.fn(() => true), run: vi.fn(async () => grounded()) },
    ...over,
  };
}

describe('createActionExecutor — execution integrity', () => {
  it('save-memory persists via the real memory port and returns ok with the id', async () => {
    const d = deps();
    const res = await createActionExecutor(d)(
      act('save-memory', { title: 'T', content: 'hello world' }),
      EVENT,
    );
    expect(res.ok).toBe(true);
    expect(d.memory.remember).toHaveBeenCalledTimes(1);
    expect(d.memory.remember).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'note',
        title: 'T',
        content: 'hello world',
        tags: ['automation'],
      }),
    );
    expect(res.message).toContain('mem:test:1');
  });

  it('save-memory with no content fails honestly and does NOT write', async () => {
    const d = deps();
    const res = await createActionExecutor(d)(act('save-memory', { title: 'T' }), EVENT);
    expect(res.ok).toBe(false);
    expect(d.memory.remember).not.toHaveBeenCalled();
  });

  it('save-memory honours a valid custom kind', async () => {
    const d = deps();
    await createActionExecutor(d)(act('save-memory', { content: 'x', kind: 'decision' }), EVENT);
    expect(d.memory.remember).toHaveBeenCalledWith(expect.objectContaining({ kind: 'decision' }));
  });

  it('ai-summarize runs the real engine (generic.summary) when configured + grounded', async () => {
    const d = deps();
    const res = await createActionExecutor(d)(act('ai-summarize', { text: 'summarize me' }), EVENT);
    expect(res.ok).toBe(true);
    expect(d.ai.run).toHaveBeenCalledTimes(1);
    expect(d.ai.run).toHaveBeenCalledWith(expect.objectContaining({ promptId: 'generic.summary' }));
  });

  it('ai-generate uses generic.generate with the instruction variable', async () => {
    const d = deps();
    await createActionExecutor(d)(act('ai-generate', { input: 'write a note' }), EVENT);
    expect(d.ai.run).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: 'generic.generate',
        variables: { instruction: 'write a note' },
      }),
    );
  });

  it('ai action fails honestly when no provider is configured (never calls run)', async () => {
    const run = vi.fn(async () => grounded());
    const d = deps({ ai: { isConfigured: () => false, run } });
    const res = await createActionExecutor(d)(act('ai-summarize', { text: 'x' }), EVENT);
    expect(res.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('ai action fails when the engine returns a non-grounded fallback', async () => {
    const d = deps({ ai: { isConfigured: () => true, run: vi.fn(async () => fallback()) } });
    const res = await createActionExecutor(d)(act('ai-generate', { text: 'x' }), EVENT);
    expect(res.ok).toBe(false);
  });

  it('ai action fails honestly when the engine throws', async () => {
    const d = deps({
      ai: {
        isConfigured: () => true,
        run: vi.fn(async () => {
          throw new Error('ollama down');
        }),
      },
    });
    const res = await createActionExecutor(d)(act('ai-summarize', { text: 'x' }), EVENT);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('failed');
  });

  it('ai action with no input text does not call the engine', async () => {
    const d = deps();
    const res = await createActionExecutor(d)(act('ai-summarize', {}), EVENT);
    expect(res.ok).toBe(false);
    expect(d.ai.run).not.toHaveBeenCalled();
  });

  it('create-reminder fails honestly (no execution path) — never a fake success', async () => {
    const res = await createActionExecutor(deps())(act('create-reminder', { text: 'call bob' }), EVENT);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not available|not.*wired/i);
  });

  it('notify delegates to the notify port and reflects its result', async () => {
    const notify = vi.fn(() => ({ ok: false, message: 'unsupported' }));
    const res = await createActionExecutor(deps({ notify }))(
      act('notify', { title: 'Hi', body: 'there' }),
      EVENT,
    );
    expect(notify).toHaveBeenCalledWith({ title: 'Hi', body: 'there' });
    expect(res.ok).toBe(false);
  });

  it('an unknown action type fails honestly rather than reporting success', async () => {
    const res = await createActionExecutor(deps())(
      act('totally-unknown' as AutomationAction['type']),
      EVENT,
    );
    expect(res.ok).toBe(false);
  });

  it('GUARANTEE: every ok:true corresponds to an invoked real port', async () => {
    const d = deps();
    const exec = createActionExecutor(d);
    const a = await exec(act('save-memory', { content: 'x' }), EVENT);
    const b = await exec(act('ai-summarize', { text: 'x' }), EVENT);
    expect(a.ok && b.ok).toBe(true);
    expect(d.memory.remember).toHaveBeenCalled();
    expect(d.ai.run).toHaveBeenCalled();
  });
});
