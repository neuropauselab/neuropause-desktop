/**
 * AI Engine Service — the single entry point every AI Worker and Executive
 * Intelligence feature calls. It owns the pipeline: render a versioned prompt,
 * fold in the assembled context, route to a model, parse the response, account
 * for tokens/cost, and write an audit record. No caller names a model, handles a
 * key, or talks to a provider. When no model is configured (or a call fails) it
 * returns a deterministic fallback so the rest of the app keeps working.
 */
import type {
  AiAuditRecord,
  AiContextItem,
  AiContextSource,
  AiEngineRequest,
  AiEngineResponse,
  AiEvidence,
  AiUsageSummary,
} from '@neuropause/shared';
import type { ModelMessage } from './modelClient';
import type { ModelRouter } from './modelRouter';
import { PromptManager } from './promptManager';
import { parseModelText } from './responseParser';
import { computeCostUsd } from './pricing';
import { UsageTracker } from './usageTracker';
import { AiAuditLog } from './auditLog';

export interface AiEngineOptions {
  router: ModelRouter;
  prompts?: PromptManager;
  audit?: AiAuditLog;
  usage?: UsageTracker;
  /** Optional sink for diagnostics; never receives secrets or prompt bodies. */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
  now?: () => string;
  id?: () => string;
}

const DEFAULT_MAX_OUTPUT = 1024;

export class AiEngine {
  private router: ModelRouter;
  private readonly prompts: PromptManager;
  readonly audit: AiAuditLog;
  readonly usage: UsageTracker;
  private readonly log: (msg: string, meta?: Record<string, unknown>) => void;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(opts: AiEngineOptions) {
    this.router = opts.router;
    this.prompts = opts.prompts ?? new PromptManager();
    this.audit = opts.audit ?? new AiAuditLog();
    this.usage = opts.usage ?? new UsageTracker();
    this.log = opts.log ?? ((): void => {});
    this.now = opts.now ?? ((): string => new Date().toISOString());
    this.newId = opts.id ?? ((): string => `ai_${Math.random().toString(36).slice(2, 11)}`);
  }

  isConfigured(): boolean {
    return this.router.isConfigured();
  }

  /**
   * Swap the active router in place (runtime reconfiguration). The engine instance,
   * and with it the shared audit log and usage/cost tracking, is preserved — only
   * the provider/model routing changes. In-flight run() calls already resolved
   * their client, so a swap never disturbs a request already under way.
   */
  setRouter(router: ModelRouter): void {
    this.router = router;
  }

  async run(req: AiEngineRequest): Promise<AiEngineResponse> {
    const started = Date.now();
    const rendered = this.prompts.render(req.promptId, {
      ...(req.variables ?? {}),
      context: renderContext(req.context ?? []),
    });
    const { model, client } = this.router.resolve(req.tier);
    const contextSources = uniqueSources(req.context ?? []);
    const contextEvidence = collectEvidence(req.context ?? []);

    // No configured model → deterministic fallback (keeps the app working).
    if (!client.isConfigured()) {
      const resp = this.fallback(req, rendered.version, contextSources, contextEvidence, started);
      this.writeAudit(resp, 'fallback');
      return resp;
    }

    const messages: ModelMessage[] = [{ role: 'user', content: rendered.user }];
    try {
      const result = await client.complete({
        model,
        system: rendered.system,
        messages,
        maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
      });
      const parsed = parseModelText(result.text);
      const costUsd = computeCostUsd(result.model, result.inputTokens, result.outputTokens);
      const resp: AiEngineResponse = {
        responseId: result.id,
        worker: req.worker,
        promptId: req.promptId,
        promptVersion: rendered.version,
        model: result.model,
        text: parsed.text,
        data: parsed.data,
        evidence: mergeEvidence(contextEvidence, parsed.evidence),
        confidence: parsed.confidence,
        usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd },
        latencyMs: Date.now() - started,
        contextSources,
        grounded: true,
      };
      this.usage.add({
        worker: req.worker,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd,
      });
      this.writeAudit(resp, 'ok');
      return resp;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      this.log('ai.run.error', { worker: req.worker, promptId: req.promptId });
      const resp = this.fallback(req, rendered.version, contextSources, contextEvidence, started);
      this.writeAudit(resp, 'error', reason);
      return resp;
    }
  }

  usageSummary(): AiUsageSummary {
    return this.usage.summary();
  }

  private fallback(
    req: AiEngineRequest,
    promptVersion: number,
    contextSources: AiContextSource[],
    evidence: AiEvidence[],
    started: number,
  ): AiEngineResponse {
    return {
      responseId: this.newId(),
      worker: req.worker,
      promptId: req.promptId,
      promptVersion,
      model: 'none',
      text: '',
      data: null,
      evidence,
      confidence: 0,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      latencyMs: Date.now() - started,
      contextSources,
      grounded: false,
    };
  }

  private writeAudit(resp: AiEngineResponse, outcome: AiAuditRecord['outcome'], error?: string): void {
    const rec: AiAuditRecord = {
      id: this.newId(),
      timestamp: this.now(),
      worker: resp.worker,
      promptId: resp.promptId,
      promptVersion: resp.promptVersion,
      model: resp.model,
      contextSources: resp.contextSources,
      inputTokens: resp.usage.inputTokens,
      outputTokens: resp.usage.outputTokens,
      costUsd: resp.usage.costUsd,
      latencyMs: resp.latencyMs,
      responseId: resp.responseId,
      confidence: resp.confidence,
      outcome,
      ...(error ? { error } : {}),
    };
    this.audit.record(rec);
  }
}

/** Flatten context items into a labelled, evidence-tagged block for the prompt. */
function renderContext(items: AiContextItem[]): string {
  if (items.length === 0) return '(no context provided)';
  return items
    .map((it) => {
      const ev =
        it.evidence && it.evidence.length > 0
          ? ` [evidence: ${it.evidence.map((e) => e.id).join(', ')}]`
          : '';
      return `## ${it.source}${ev}\n${it.text}`;
    })
    .join('\n\n');
}

function uniqueSources(items: AiContextItem[]): AiContextSource[] {
  return [...new Set(items.map((i) => i.source))];
}

function collectEvidence(items: AiContextItem[]): AiEvidence[] {
  const out: AiEvidence[] = [];
  for (const it of items) for (const e of it.evidence ?? []) out.push(e);
  return dedupeEvidence(out);
}

function mergeEvidence(a: AiEvidence[], b: AiEvidence[]): AiEvidence[] {
  return dedupeEvidence([...a, ...b]);
}

function dedupeEvidence(list: AiEvidence[]): AiEvidence[] {
  const seen = new Set<string>();
  const out: AiEvidence[] = [];
  for (const e of list) {
    const key = `${e.kind}:${e.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}
