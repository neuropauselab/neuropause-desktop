/**
 * Automation action executor (Global RC Phase 1 — execution integrity).
 *
 * Maps each automation action to a REAL side-effect through injected ports, so an
 * action reports `ok:true` ONLY when the underlying subsystem actually performed
 * the work. Actions whose subsystem cannot run — no AI provider configured, or a
 * reminder engine that has no execution path — return an HONEST failure. It never
 * returns a fabricated success for a no-op (the pre-RC behaviour that let the
 * runner record "completed" while nothing happened).
 *
 * Pure + Electron-free: the effects (notification, memory write, AI run) are all
 * injected ports, so the executor is unit-tested with fakes. The real bindings
 * (Electron Notification, the MemoryStore singleton, the AiEngine) are supplied
 * in `automationSubsystem.ts`.
 */
import type { AiEngineRequest, AiEngineResponse, MemoryKind, MemoryWriteInput } from '@neuropause/shared';
import { MEMORY_KINDS } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { ActionExecutor } from './automationRunner';
import { ALL_M365_ACTIONS } from '../connectors/m365';
import { classifyConnectorWrite } from './automationConnectorWrite';

const log = createLogger('automation-actions');

/** Result contract shared by every port (mirrors the runner's ActionExecutor). */
export interface ActionEffectResult {
  ok: boolean;
  message?: string;
}

/** The real subsystems the executor drives, injected so it stays pure/testable. */
export interface ActionExecutorDeps {
  /** Fire a desktop notification; ok:false when it could not be shown. */
  notify: (input: { title: string; body: string }) => ActionEffectResult;
  /** AI Memory write path (the real MemoryStore.remember). */
  memory: { remember(input: MemoryWriteInput): { id: string } };
  /** The AI engine: whether a real provider is configured, and the run() call. */
  ai: { isConfigured(): boolean; run(req: AiEngineRequest): Promise<AiEngineResponse> };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function toMemoryKind(v: unknown): MemoryKind {
  return typeof v === 'string' && (MEMORY_KINDS as readonly string[]).includes(v)
    ? (v as MemoryKind)
    : 'note';
}

/**
 * Build an action executor bound to the real subsystems. `ok:true` means the
 * effect genuinely occurred; any other outcome returns an honest failure so the
 * runner stops the chain and records the run as failed (never a fake success).
 */
export function createActionExecutor(deps: ActionExecutorDeps): ActionExecutor {
  return async (action) => {
    switch (action.type) {
      case 'notify': {
        const title = str(action.config?.title) || 'NeuroPause automation';
        const body = str(action.config?.body) || action.label;
        try {
          return deps.notify({ title, body });
        } catch (err) {
          return { ok: false, message: String(err) };
        }
      }

      case 'save-memory': {
        const content = str(action.config?.content) || str(action.config?.body);
        if (!content) return { ok: false, message: 'save-memory: nothing to store (no content)' };
        const title = str(action.config?.title) || action.label || 'Automation note';
        try {
          const item = deps.memory.remember({
            kind: toMemoryKind(action.config?.kind),
            title,
            content,
            tags: ['automation'],
          });
          log.info('automation saved memory', { id: item.id, label: action.label });
          return { ok: true, message: `Saved to AI Memory (${item.id})` };
        } catch (err) {
          return { ok: false, message: `save-memory failed: ${String(err)}` };
        }
      }

      case 'ai-summarize':
      case 'ai-generate': {
        if (!deps.ai.isConfigured()) {
          return {
            ok: false,
            message: `${action.type}: no AI provider is configured (connect one in Settings)`,
          };
        }
        const input =
          str(action.config?.text) || str(action.config?.input) || str(action.config?.content);
        if (!input) return { ok: false, message: `${action.type}: no input text provided` };
        const req: AiEngineRequest =
          action.type === 'ai-summarize'
            ? {
                worker: 'assistant',
                promptId: 'generic.summary',
                tier: 'fast',
                maxOutputTokens: 512,
                context: [{ source: 'unified-model', text: input, evidence: [] }],
              }
            : {
                worker: 'assistant',
                promptId: 'generic.generate',
                tier: 'fast',
                maxOutputTokens: 512,
                variables: { instruction: input },
                context: [{ source: 'unified-model', text: input, evidence: [] }],
              };
        try {
          const resp = await deps.ai.run(req);
          // `grounded` is true ONLY when a real model produced the output; the engine
          // returns a grounded:false fallback when unconfigured or on error, which we
          // must not report as a successful AI action.
          if (!resp.grounded) {
            return { ok: false, message: `${action.type}: AI provider unavailable` };
          }
          return { ok: true, message: `${action.type} completed` };
        } catch (err) {
          return { ok: false, message: `${action.type} failed: ${String(err)}` };
        }
      }

      case 'create-reminder':
        // Honest: no reminder execution path is wired in the app today (the
        // assistant itself reports "reminder port not wired"). Never a fake success.
        return {
          ok: false,
          message: 'create-reminder: reminders are not available yet (no execution path is wired)',
        };

      case 'connector-write': {
        // An automation fires autonomously, so a connector write is NEVER executed
        // here: it is classified against the real M365 write registry and HELD for
        // explicit user confirmation ("AI must never send/modify data automatically").
        const outcome = classifyConnectorWrite(action, ALL_M365_ACTIONS);
        log.info('automation connector-write held for confirmation', {
          label: action.label,
          connectorId: action.connectorId,
          mutates: outcome.mutates,
          resolved: outcome.resolved,
        });
        return { ok: outcome.ok, message: outcome.message };
      }

      default:
        return { ok: false, message: `Unsupported automation action: ${String(action.type)}` };
    }
  };
}
