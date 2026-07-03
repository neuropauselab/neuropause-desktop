/**
 * The model abstraction the Model Router speaks. Every provider (Claude today,
 * GPT/Gemini/local later) implements ModelClient; the rest of the app never sees
 * a provider-specific shape. Pure: no Electron, only fetch + types.
 */

/** One chat turn handed to a model. */
export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A provider-agnostic completion request. */
export interface ModelRequest {
  model: string;
  system?: string;
  messages: ModelMessage[];
  maxOutputTokens: number;
}

/** A provider-agnostic completion result. */
export interface ModelResult {
  /** Provider response id (for audit). */
  id: string;
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelClient {
  /** Stable provider id, e.g. 'anthropic'. */
  readonly provider: string;
  /** True when the client is configured to make real calls (e.g. key present). */
  isConfigured(): boolean;
  complete(req: ModelRequest): Promise<ModelResult>;
}
