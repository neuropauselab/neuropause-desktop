/**
 * NeuroPause AI Gateway — the ONLY place provider credentials live.
 *
 * NP-GLOBAL-PUBLIC-LAUNCH-001 §6/§7 · 002 §24/§25. The desktop, web and mobile
 * clients never hold a provider key: they call this gateway with their session
 * bearer, the gateway calls the live frontier/local model with a SERVER-side key,
 * and returns the model's text plus any TOOL PROPOSALS. The gateway never
 * executes a tool, never grants authority, and never returns an `authorized`
 * field — "AI said yes" is not, and cannot become, "NeuroPause authorized".
 *
 *   USER INTENT → (client) → GATEWAY → LIVE MODEL → text + tool_proposals → (client)
 *   → NeuroPause POLICY → ADMISSIBLE SET → HUMAN/AUTHORITY → TOOL EXECUTION (Computer-B)
 *   → OBSERVATION → next turn … (see apps/desktop/src/main/ai/gatewayAgentLoop.ts)
 *
 * Providers (selected by AI_GATEWAY_PROVIDER, keys by env only):
 *   ollama     local/self-hosted, POST {base}/api/chat with `tools`
 *   anthropic  POST https://api.anthropic.com/v1/messages (ANTHROPIC_API_KEY)
 *   openai     POST https://api.openai.com/v1/chat/completions (OPENAI_API_KEY)
 *   none       gateway reports configured:false and refuses (503 ai_unavailable)
 *
 * Bounds enforced here (defaults; env-tunable): message count, total input chars,
 * output tokens, per-request timeout. No retries on the model call — a caller that
 * wants retries owns its own budget (the desktop loop caps turns and retries).
 */
import { randomUUID } from 'node:crypto';

export type GatewayRole = 'system' | 'user' | 'assistant' | 'tool';
export interface GatewayMessage {
  role: GatewayRole;
  content: string;
  /** For role=tool: the proposal this result answers. */
  tool_call_id?: string;
  /** For role=tool: the tool name. */
  name?: string;
}
export interface GatewayTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolProposal {
  proposal_id: string;
  tool: string;
  arguments: Record<string, unknown>;
}
export interface GatewayRequest {
  messages: GatewayMessage[];
  tools?: GatewayTool[];
  maxOutputTokens?: number;
}
export interface GatewayResponse {
  id: string;
  provider: string;
  model: string;
  text: string;
  tool_proposals: ToolProposal[];
  finish_reason: 'stop' | 'tool_proposal' | 'length' | 'unknown';
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
  gateway: { version: 'np.ai.gateway/v1'; policy: 'AI_PROPOSES_ONLY'; executes_tools: false; grants_authority: false };
}

export interface GatewayConfig {
  provider: 'none' | 'ollama' | 'anthropic' | 'openai';
  model: string;
  baseUrl?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  timeoutMs: number;
  maxMessages: number;
  maxInputChars: number;
  maxOutputTokens: number;
}

export class GatewayError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
  }
}

export function gatewayConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const provider = (env.AI_GATEWAY_PROVIDER ?? 'none').toLowerCase();
  return {
    provider: provider === 'ollama' || provider === 'anthropic' || provider === 'openai' ? provider : 'none',
    model: env.AI_GATEWAY_MODEL ?? (provider === 'anthropic' ? 'claude-sonnet-5' : provider === 'openai' ? 'gpt-4o' : 'qwen3-coder:30b'),
    baseUrl: env.AI_GATEWAY_BASE_URL ?? (provider === 'ollama' ? 'http://127.0.0.1:11434' : undefined),
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    timeoutMs: Number(env.AI_GATEWAY_TIMEOUT_MS ?? 120_000),
    maxMessages: Number(env.AI_GATEWAY_MAX_MESSAGES ?? 64),
    maxInputChars: Number(env.AI_GATEWAY_MAX_INPUT_CHARS ?? 200_000),
    maxOutputTokens: Number(env.AI_GATEWAY_MAX_OUTPUT_TOKENS ?? 2048),
  };
}

/** True when a live model can be called with the present configuration. Never exposes a key. */
export function gatewayConfigured(cfg: GatewayConfig): boolean {
  if (cfg.provider === 'ollama') return !!cfg.baseUrl;
  if (cfg.provider === 'anthropic') return !!cfg.anthropicApiKey;
  if (cfg.provider === 'openai') return !!cfg.openaiApiKey;
  return false;
}

export function validateRequest(cfg: GatewayConfig, req: unknown): GatewayRequest {
  const r = req as GatewayRequest;
  if (!r || !Array.isArray(r.messages) || r.messages.length === 0) throw new GatewayError(400, 'invalid_request', 'messages[] is required.');
  if (r.messages.length > cfg.maxMessages) throw new GatewayError(413, 'too_many_messages', `At most ${cfg.maxMessages} messages per request.`);
  let chars = 0;
  for (const m of r.messages) {
    if (!m || typeof m.content !== 'string' || !['system', 'user', 'assistant', 'tool'].includes(m.role)) throw new GatewayError(400, 'invalid_message', 'Each message needs a role and string content.');
    chars += m.content.length;
  }
  if (chars > cfg.maxInputChars) throw new GatewayError(413, 'input_too_large', `Input exceeds ${cfg.maxInputChars} characters.`);
  if (r.tools !== undefined) {
    if (!Array.isArray(r.tools) || r.tools.length > 32) throw new GatewayError(400, 'invalid_tools', 'tools must be an array of at most 32 entries.');
    for (const t of r.tools) {
      if (!t || typeof t.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(t.name)) throw new GatewayError(400, 'invalid_tool', 'tool names are [a-z][a-z0-9_]{0,63}.');
      chars += (typeof t.description === 'string' ? t.description.length : 0) + JSON.stringify(t.parameters ?? {}).length;
    }
    if (chars > cfg.maxInputChars) throw new GatewayError(413, 'input_too_large', `Input (messages + tools) exceeds ${cfg.maxInputChars} characters.`);
  }
  const requested = Number(r.maxOutputTokens);
  const maxOutputTokens = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), cfg.maxOutputTokens) : cfg.maxOutputTokens;
  return { messages: r.messages, tools: r.tools, maxOutputTokens };
}

type FetchLike = typeof fetch;

async function post(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new GatewayError(504, 'provider_timeout', `Model provider timed out after ${timeoutMs} ms.`);
    throw new GatewayError(502, 'provider_unreachable', `Model provider unreachable: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

function proposal(tool: string, args: unknown, id?: string): ToolProposal {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  return { proposal_id: id || `prop_${randomUUID()}`, tool, arguments: a };
}

export async function completeViaProvider(cfg: GatewayConfig, req: GatewayRequest, fetchImpl: FetchLike = fetch): Promise<GatewayResponse> {
  if (!gatewayConfigured(cfg)) throw new GatewayError(503, 'ai_unavailable', 'The AI gateway has no live model configured.');
  const started = Date.now();
  const base: Omit<GatewayResponse, 'text' | 'tool_proposals' | 'finish_reason' | 'usage' | 'model' | 'latency_ms'> = {
    id: `gw_${randomUUID()}`, provider: cfg.provider, gateway: { version: 'np.ai.gateway/v1', policy: 'AI_PROPOSES_ONLY', executes_tools: false, grants_authority: false },
  };

  if (cfg.provider === 'ollama') {
    const body: Record<string, unknown> = { model: cfg.model, stream: false, options: { num_predict: req.maxOutputTokens }, messages: req.messages.map((m) => (m.role === 'tool' ? { role: 'tool', content: m.content, tool_name: m.name } : { role: m.role, content: m.content })) };
    if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    const res = await post(fetchImpl, `${cfg.baseUrl!.replace(/\/+$/, '')}/api/chat`, {}, body, cfg.timeoutMs);
    const json = (await res.json().catch(() => ({}))) as { model?: string; message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> }; prompt_eval_count?: number; eval_count?: number; done_reason?: string; error?: string };
    if (!res.ok || json.error) throw new GatewayError(502, 'provider_error', `Ollama: ${json.error ?? `HTTP ${res.status}`}`);
    const proposals = (json.message?.tool_calls ?? []).filter((c) => c.function?.name).map((c) => proposal(String(c.function!.name), c.function!.arguments));
    return { ...base, model: json.model ?? cfg.model, text: json.message?.content ?? '', tool_proposals: proposals, finish_reason: proposals.length ? 'tool_proposal' : json.done_reason === 'length' ? 'length' : 'stop', usage: { input_tokens: json.prompt_eval_count ?? 0, output_tokens: json.eval_count ?? 0 }, latency_ms: Date.now() - started };
  }

  if (cfg.provider === 'anthropic') {
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const messages = req.messages.filter((m) => m.role !== 'system').map((m) => (m.role === 'tool' ? { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] } : { role: m.role, content: m.content }));
    const body: Record<string, unknown> = { model: cfg.model, max_tokens: req.maxOutputTokens, messages, ...(system ? { system } : {}) };
    if (req.tools?.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const res = await post(fetchImpl, 'https://api.anthropic.com/v1/messages', { 'x-api-key': cfg.anthropicApiKey!, 'anthropic-version': '2023-06-01' }, body, cfg.timeoutMs);
    const json = (await res.json().catch(() => ({}))) as { model?: string; content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
    if (!res.ok || json.error) throw new GatewayError(502, 'provider_error', `Anthropic: ${json.error?.message ?? `HTTP ${res.status}`}`);
    const text = (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    const proposals = (json.content ?? []).filter((c) => c.type === 'tool_use' && c.name).map((c) => proposal(String(c.name), c.input, c.id));
    return { ...base, model: json.model ?? cfg.model, text, tool_proposals: proposals, finish_reason: json.stop_reason === 'tool_use' ? 'tool_proposal' : json.stop_reason === 'max_tokens' ? 'length' : 'stop', usage: { input_tokens: json.usage?.input_tokens ?? 0, output_tokens: json.usage?.output_tokens ?? 0 }, latency_ms: Date.now() - started };
  }

  // openai
  const messages = req.messages.map((m) => (m.role === 'tool' ? { role: 'tool', content: m.content, tool_call_id: m.tool_call_id } : { role: m.role, content: m.content }));
  const body: Record<string, unknown> = { model: cfg.model, max_tokens: req.maxOutputTokens, messages };
  if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const res = await post(fetchImpl, 'https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${cfg.openaiApiKey}` }, body, cfg.timeoutMs);
  const json = (await res.json().catch(() => ({}))) as { model?: string; choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
  if (!res.ok || json.error) throw new GatewayError(502, 'provider_error', `OpenAI: ${json.error?.message ?? `HTTP ${res.status}`}`);
  const choice = json.choices?.[0];
  const proposals = (choice?.message?.tool_calls ?? []).filter((c) => c.function?.name).map((c) => { let args: unknown = {}; try { args = JSON.parse(c.function!.arguments ?? '{}'); } catch { args = {}; } return proposal(String(c.function!.name), args, c.id); });
  return { ...base, model: json.model ?? cfg.model, text: choice?.message?.content ?? '', tool_proposals: proposals, finish_reason: proposals.length ? 'tool_proposal' : choice?.finish_reason === 'length' ? 'length' : 'stop', usage: { input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0 }, latency_ms: Date.now() - started };
}

/** Defense in depth: a response object must never carry an authority claim, whatever a provider returns. */
export function assertNoAuthorityClaim(resp: GatewayResponse): GatewayResponse {
  // NP-PUBLIC-LAUNCH-003 §15: the forbidden set covers every phrasing an adversarial
  // model or a compromised provider could use to smuggle an authority claim into the
  // response envelope (top level AND inside `gateway`). Tool arguments and text are
  // deliberately NOT scrubbed — they are data the policy engine must be able to see.
  const forbidden = ['authorized', 'approved', 'authorization', 'permission_granted', 'admissible', 'grant_authority', 'grants_authority_override', 'execute', 'executed', 'human_approved', 'admin_override', 'confirmation_waived'];
  for (const k of Object.keys(resp)) if (forbidden.includes(k.toLowerCase())) throw new GatewayError(500, 'gateway_invariant', `gateway response must not carry "${k}"`);
  const g = resp.gateway as unknown as Record<string, unknown> | undefined;
  if (!g || g.policy !== 'AI_PROPOSES_ONLY' || g.executes_tools !== false || g.grants_authority !== false) throw new GatewayError(500, 'gateway_invariant', 'gateway envelope must assert AI_PROPOSES_ONLY / executes_tools:false / grants_authority:false');
  for (const k of Object.keys(g)) if (!['version', 'policy', 'executes_tools', 'grants_authority'].includes(k)) throw new GatewayError(500, 'gateway_invariant', `gateway envelope must not carry "${k}"`);
  return resp;
}
