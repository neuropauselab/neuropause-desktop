/**
 * Deterministic model client for tests and for running without an API key. It
 * never makes a network call; it returns a stable, shaped response so the engine,
 * parser, trackers and audit can be exercised end-to-end offline.
 */
import type { ModelClient, ModelRequest, ModelResult } from './modelClient';

export interface MockClientOptions {
  /** Fixed text to return; if omitted, echoes a short deterministic reply. */
  reply?: (req: ModelRequest) => string;
  inputTokens?: number;
  outputTokens?: number;
}

export class MockModelClient implements ModelClient {
  readonly provider = 'mock';
  private readonly opts: MockClientOptions;
  constructor(opts: MockClientOptions = {}) {
    this.opts = opts;
  }
  isConfigured(): boolean {
    return true;
  }
  async complete(req: ModelRequest): Promise<ModelResult> {
    const text = this.opts.reply ? this.opts.reply(req) : defaultReply(req);
    const inputText = [req.system ?? '', ...req.messages.map((m) => m.content)].join('\n');
    return {
      id: 'mock-response',
      model: req.model,
      text,
      inputTokens: this.opts.inputTokens ?? estimateTokens(inputText),
      outputTokens: this.opts.outputTokens ?? estimateTokens(text),
    };
  }
}

function defaultReply(req: ModelRequest): string {
  const last = req.messages[req.messages.length - 1]?.content ?? '';
  return `MOCK: ${last.slice(0, 80)}`;
}

/** Rough token estimate (~4 chars/token) for offline accounting. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
