/**
 * Desktop → NeuroPause AI Gateway client. The desktop holds NO provider key on
 * this lane: it sends its session bearer to `${backendUrl}/ai/chat` and the
 * gateway calls the live model with a server-side credential.
 *
 * Two shapes are exposed:
 *   • `GatewayModelClient` — a `ModelClient` for the existing AiEngine/ModelRouter
 *     (single-turn text completion through the gateway).
 *   • `gatewayChat` — the raw multi-message + tools call used by the governed
 *     agent loop (gatewayAgentLoop.ts).
 *
 * `fetchImpl` and the token source are injected so the client is testable and
 * so no module here imports Electron.
 */
import type { ModelClient, ModelRequest, ModelResult } from './modelClient';

export type GatewayRole = 'system' | 'user' | 'assistant' | 'tool';
export interface GatewayMessage { role: GatewayRole; content: string; tool_call_id?: string; name?: string }
export interface GatewayTool { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolProposal { proposal_id: string; tool: string; arguments: Record<string, unknown> }
export interface GatewayResponse {
  id: string; provider: string; model: string; text: string; tool_proposals: ToolProposal[];
  finish_reason: 'stop' | 'tool_proposal' | 'length' | 'unknown';
  usage: { input_tokens: number; output_tokens: number }; latency_ms: number;
  gateway: { version: string; policy: 'AI_PROPOSES_ONLY'; executes_tools: false; grants_authority: false };
}

export interface GatewayClientOptions {
  backendUrl: string;
  /** Returns the current access token or null when signed out. Never persisted here. */
  accessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class GatewayUnavailableError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.name = 'GatewayUnavailableError'; this.status = status; this.code = code; }
}

export async function gatewayChat(opts: GatewayClientOptions, req: { messages: GatewayMessage[]; tools?: GatewayTool[]; maxOutputTokens?: number }): Promise<GatewayResponse> {
  const token = await opts.accessToken();
  if (!token) throw new GatewayUnavailableError(401, 'signed_out', 'Sign in to use the NeuroPause AI service.');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 130_000);
  let res: Response;
  try {
    res = await fetchImpl(`${opts.backendUrl.replace(/\/+$/, '')}/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(req), signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new GatewayUnavailableError(0, 'timeout', 'The AI service did not answer in time.');
    throw new GatewayUnavailableError(0, 'network_error', `The AI service is unreachable: ${(err as Error).message}`);
  } finally { clearTimeout(timer); }
  const json = (await res.json().catch(() => ({}))) as Partial<GatewayResponse> & { error?: string; message?: string };
  if (!res.ok) throw new GatewayUnavailableError(res.status, json.error ?? `http_${res.status}`, json.message ?? `AI gateway answered HTTP ${res.status}`);
  const g = json.gateway as unknown as Record<string, unknown> | undefined;
  if (!g || g.policy !== 'AI_PROPOSES_ONLY' || g.grants_authority !== false || g.executes_tools !== false) {
    throw new GatewayUnavailableError(502, 'gateway_invariant', 'AI gateway response lacked a valid AI_PROPOSES_ONLY envelope.');
  }
  // Re-shape strictly: unknown top-level keys are dropped, proposals are validated per entry.
  const proposals: ToolProposal[] = (Array.isArray(json.tool_proposals) ? json.tool_proposals : []).filter((p) => p && typeof p === 'object' && typeof p.proposal_id === 'string' && typeof p.tool === 'string').map((p) => ({ proposal_id: p.proposal_id, tool: p.tool, arguments: p.arguments && typeof p.arguments === 'object' && !Array.isArray(p.arguments) ? p.arguments : {} }));
  return { id: String(json.id ?? ''), provider: String(json.provider ?? ''), model: String(json.model ?? ''), text: typeof json.text === 'string' ? json.text : '', tool_proposals: proposals, finish_reason: (['stop', 'tool_proposal', 'length', 'unknown'] as const).includes(json.finish_reason as never) ? (json.finish_reason as GatewayResponse['finish_reason']) : 'unknown', usage: { input_tokens: Number(json.usage?.input_tokens ?? 0) || 0, output_tokens: Number(json.usage?.output_tokens ?? 0) || 0 }, latency_ms: Number(json.latency_ms ?? 0) || 0, gateway: { version: String(g.version ?? ''), policy: 'AI_PROPOSES_ONLY', executes_tools: false, grants_authority: false } };
}

export class GatewayModelClient implements ModelClient {
  readonly provider = 'gateway';
  constructor(private readonly opts: GatewayClientOptions) {}
  /** Configured means a backend URL exists; whether a session exists is decided per call (fail closed at call time). */
  isConfigured(): boolean { return /^https?:\/\//.test(this.opts.backendUrl); }
  async complete(req: ModelRequest): Promise<ModelResult> {
    const messages: GatewayMessage[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });
    const out = await gatewayChat(this.opts, { messages, maxOutputTokens: req.maxOutputTokens });
    return { id: out.id, model: out.model, text: out.text, inputTokens: out.usage.input_tokens, outputTokens: out.usage.output_tokens };
  }
}
