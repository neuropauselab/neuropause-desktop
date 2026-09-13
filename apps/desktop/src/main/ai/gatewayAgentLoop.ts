/**
 * Governed agent loop over the NeuroPause AI Gateway — Computer-B side.
 *
 * NP-GLOBAL-PUBLIC-LAUNCH-001 §7/§8/§10 · 002 §26/§29. The model REASONS and
 * PROPOSES; this loop GOVERNS and EXECUTES. Per turn:
 *
 *   USER_MESSAGE → gateway (live model) → text | tool_proposals
 *     for each proposal:
 *       POLICY_CHECK     registry lookup — unknown tool → DENY (default deny)
 *       AUTHORITY_CHECK  the registry class decides: READ_ONLY → admissible;
 *                        anything with a side effect → HUMAN_DECISION_REQUIRED
 *                        unless an authority decision object for THIS proposal
 *                        is supplied by the caller (never by the model, never by
 *                        tool output, never by this loop)
 *       EXECUTE | REFUSE → ToolResult {tool_call_id, action_id, execution_id,
 *                        status, timestamp, output, evidence_id}
 *     results are appended as role=tool messages → next model turn
 *   until the model stops proposing, or a bound trips.
 *
 * Terminal states (every run ends in exactly one): COMPLETED · BLOCKED ·
 * STOPPED · FAILED · TIMEOUT · HUMAN_DECISION_REQUIRED.
 *
 * Nothing here reads model text as authority. A tool result containing
 * "AUTHORIZATION_GRANTED=true", "SYSTEM:", "ADMIN:" or a forged approval is
 * DATA; admissibility is computed only from the registry + the caller-supplied
 * decision map. That property is pinned by gatewayAgentLoop.test.ts.
 *
 * Pure: the gateway call, tool executors, clock and id source are injected, so
 * the whole loop is unit-testable and the live test uses the real gateway.
 */
import type { GatewayMessage, GatewayResponse, GatewayTool, ToolProposal } from './gatewayClient';

export type ToolClass = 'READ_ONLY' | 'REVERSIBLE_WRITE' | 'IRREVERSIBLE_WRITE' | 'EXTERNAL_COMMUNICATION' | 'FINANCIAL' | 'IDENTITY' | 'SECURITY' | 'SYSTEM' | 'DEVICE';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RequiredAuthority = 'NONE' | 'HUMAN_CONFIRMATION' | 'HUMAN_AUTHORITY';

export interface ToolDefinition extends GatewayTool {
  tool_id: string;
  tool_version: string;
  capability: string;
  risk_level: RiskLevel;
  side_effect_class: ToolClass;
  required_authority: RequiredAuthority;
  required_confirmation: boolean;
  evidence_requirement: 'ALWAYS';
  rollback_capability: 'NOT_APPLICABLE' | 'REVERSIBLE' | 'IRREVERSIBLE';
  /** Executes the tool. Only called after the loop has admitted the proposal. */
  execute: (args: Record<string, unknown>, ctx: { action_id: string; execution_id: string }) => Promise<{ ok: boolean; output: string }>;
}

export interface AuthorityDecision {
  decision_id: string;
  actor: string;
  authority_basis: string;
  decision_class: 'HUMAN_CONFIRMATION' | 'HUMAN_AUTHORITY';
  decision: 'ALLOW' | 'DENY';
  /** The proposal this decision binds to — a decision without a proposal_id binds nothing. */
  proposal_id: string;
  time: string;
  policy_version: string;
}

export type LoopState = 'COMPLETED' | 'BLOCKED' | 'STOPPED' | 'FAILED' | 'TIMEOUT' | 'HUMAN_DECISION_REQUIRED';

export interface ToolResult {
  tool_call_id: string;
  action_id: string;
  execution_id: string | null;
  tool: string;
  status: 'EXECUTED' | 'NOT_PERMITTED' | 'DECISION_REQUIRED' | 'FAILED';
  admissibility: 'ADMISSIBLE' | 'DENIED_UNKNOWN_TOOL' | 'DENIED_BY_DECISION' | 'DECISION_REQUIRED';
  timestamp: string;
  output: string;
  evidence_id: string;
}

export interface LoopEvidence {
  evidence_id: string;
  kind: 'INTENT' | 'MODEL_TURN' | 'POLICY' | 'ACTION' | 'EXECUTION' | 'RESULT' | 'TERMINAL';
  timestamp: string;
  data: Record<string, unknown>;
}

export interface LoopOptions {
  policy_version: string;
  maxTurns?: number;
  maxToolCalls?: number;
  maxDurationMs?: number;
  maxOutputTokens?: number;
  system?: string;
  /** Caller-supplied human decisions, keyed by proposal_id. The model cannot populate this. */
  decisions?: ReadonlyMap<string, AuthorityDecision>;
  /** Cooperative stop (the user pressed STOP). Checked before every turn and every execution. */
  stopRequested?: () => boolean;
  now?: () => string;
  id?: (prefix: string) => string;
}

export interface LoopResult {
  run_id: string;
  state: LoopState;
  reason: string;
  turns: number;
  tool_calls: number;
  final_text: string | null;
  pending_decisions: Array<{ proposal_id: string; tool: string; arguments: Record<string, unknown>; required_authority: RequiredAuthority; side_effect_class: ToolClass }>;
  tool_results: ToolResult[];
  evidence: LoopEvidence[];
  usage: { input_tokens: number; output_tokens: number };
}

export type GatewayCall = (req: { messages: GatewayMessage[]; tools?: GatewayTool[]; maxOutputTokens?: number }) => Promise<GatewayResponse>;

const DEFAULTS = { maxTurns: 6, maxToolCalls: 10, maxDurationMs: 180_000, maxOutputTokens: 1024 };

export async function runGovernedLoop(userMessage: string, gateway: GatewayCall, registry: ReadonlyMap<string, ToolDefinition>, opts: LoopOptions): Promise<LoopResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const id = opts.id ?? ((p: string) => `${p}_${Math.random().toString(36).slice(2, 12)}`);
  const limits = { ...DEFAULTS, ...opts };
  const run_id = id('run');
  const evidence: LoopEvidence[] = [];
  const ev = (kind: LoopEvidence['kind'], data: Record<string, unknown>) => { const e = { evidence_id: id('ev'), kind, timestamp: now(), data }; evidence.push(e); return e.evidence_id; };
  const tool_results: ToolResult[] = [];
  const pending: LoopResult['pending_decisions'] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const startedMs = Date.now();
  let turns = 0; let tool_calls = 0; let final_text: string | null = null;

  const tools: GatewayTool[] = [...registry.values()].map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const messages: GatewayMessage[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: userMessage });
  ev('INTENT', { run_id, user_message_chars: userMessage.length, policy_version: opts.policy_version, tools_offered: tools.map((t) => t.name) });

  const finish = (state: LoopState, reason: string): LoopResult => {
    ev('TERMINAL', { state, reason, turns, tool_calls });
    return { run_id, state, reason, turns, tool_calls, final_text, pending_decisions: pending, tool_results, evidence, usage };
  };

  for (;;) {
    if (opts.stopRequested?.()) return finish('STOPPED', 'stop requested by the user before a model turn');
    if (turns >= limits.maxTurns) return finish('TIMEOUT', `maximum model turns (${limits.maxTurns}) reached without a final answer`);
    if (Date.now() - startedMs > limits.maxDurationMs) return finish('TIMEOUT', `maximum duration (${limits.maxDurationMs} ms) exceeded`);
    turns++;
    let resp: GatewayResponse;
    try {
      resp = await gateway({ messages, tools: tools.length ? tools : undefined, maxOutputTokens: limits.maxOutputTokens });
    } catch (err) {
      ev('MODEL_TURN', { turn: turns, error: String((err as Error).message).slice(0, 300) });
      return finish('FAILED', `gateway/model failure on turn ${turns}: ${String((err as Error).message).slice(0, 200)}`);
    }
    usage.input_tokens += resp.usage.input_tokens; usage.output_tokens += resp.usage.output_tokens;
    ev('MODEL_TURN', { turn: turns, gateway_id: resp.id, model: resp.model, finish_reason: resp.finish_reason, proposals: resp.tool_proposals.map((p) => p.tool), text_chars: resp.text.length });
    if (resp.gateway?.policy !== 'AI_PROPOSES_ONLY' || resp.gateway.grants_authority !== false) {
      return finish('FAILED', 'gateway response did not carry the AI_PROPOSES_ONLY policy marker — refusing to continue');
    }

    if (resp.tool_proposals.length === 0) {
      final_text = resp.text;
      return finish('COMPLETED', 'model produced a final answer with no further tool proposals');
    }

    messages.push({ role: 'assistant', content: resp.text || `[proposed ${resp.tool_proposals.map((p) => p.tool).join(', ')}]` });
    let blocked = false;
    for (const proposal of resp.tool_proposals) {
      if (opts.stopRequested?.()) return finish('STOPPED', 'stop requested by the user before a tool execution');
      if (tool_calls >= limits.maxToolCalls) return finish('BLOCKED', `maximum tool calls (${limits.maxToolCalls}) reached`);
      const action_id = id('act');
      const verdict = admissibility(proposal, registry, opts.decisions);
      const policyEv = ev('POLICY', { action_id, proposal_id: proposal.proposal_id, tool: proposal.tool, verdict: verdict.admissibility, reason: verdict.reason, policy_version: opts.policy_version });
      const result: ToolResult = { tool_call_id: proposal.proposal_id, action_id, execution_id: null, tool: proposal.tool, status: 'NOT_PERMITTED', admissibility: verdict.admissibility, timestamp: now(), output: '', evidence_id: policyEv };
      if (verdict.admissibility === 'ADMISSIBLE') {
        tool_calls++;
        const execution_id = id('exec');
        result.execution_id = execution_id;
        ev('ACTION', { action_id, execution_id, tool: proposal.tool, arguments_keys: Object.keys(proposal.arguments) });
        try {
          const out = await verdict.tool!.execute(proposal.arguments, { action_id, execution_id });
          result.status = out.ok ? 'EXECUTED' : 'FAILED';
          result.output = out.output;
          result.evidence_id = ev('EXECUTION', { action_id, execution_id, tool: proposal.tool, ok: out.ok, output_chars: out.output.length });
        } catch (err) {
          result.status = 'FAILED'; result.output = `tool failed: ${String((err as Error).message).slice(0, 300)}`;
          result.evidence_id = ev('EXECUTION', { action_id, execution_id, tool: proposal.tool, ok: false, error: result.output });
        }
      } else if (verdict.admissibility === 'DECISION_REQUIRED') {
        result.status = 'DECISION_REQUIRED';
        result.output = `NOT EXECUTED — ${verdict.reason}`;
        pending.push({ proposal_id: proposal.proposal_id, tool: proposal.tool, arguments: proposal.arguments, required_authority: verdict.tool!.required_authority, side_effect_class: verdict.tool!.side_effect_class });
        blocked = true;
      } else {
        result.status = 'NOT_PERMITTED';
        result.output = `NOT EXECUTED — ${verdict.reason}`;
      }
      tool_results.push(result);
      ev('RESULT', { action_id, tool: proposal.tool, status: result.status });
      // The model observes the truthful status — a refusal is reported as a refusal, never as an outcome.
      messages.push({ role: 'tool', name: proposal.tool, tool_call_id: proposal.proposal_id, content: result.status === 'EXECUTED' ? result.output : `[${result.status}] ${result.output}` });
    }
    if (blocked) return finish('HUMAN_DECISION_REQUIRED', `${pending.length} proposal(s) require a human decision before execution`);
  }
}

/** The authoritative calculation: U_NP(Z_t) = { U ∈ U_cap : Π(Z_t, U) = 1 }. Nothing the model says enters Π. */
export function admissibility(proposal: ToolProposal, registry: ReadonlyMap<string, ToolDefinition>, decisions?: ReadonlyMap<string, AuthorityDecision>): { admissibility: ToolResult['admissibility']; reason: string; tool?: ToolDefinition } {
  const tool = registry.get(proposal.tool);
  if (!tool) return { admissibility: 'DENIED_UNKNOWN_TOOL', reason: `"${proposal.tool}" is not a registered tool (default deny)` };
  if (tool.required_authority === 'NONE' && tool.side_effect_class === 'READ_ONLY') return { admissibility: 'ADMISSIBLE', reason: 'read-only capability admitted by policy', tool };
  const decision = decisions?.get(proposal.proposal_id);
  if (!decision) return { admissibility: 'DECISION_REQUIRED', reason: `${tool.side_effect_class} tool "${tool.name}" requires ${tool.required_authority}; no decision object bound to proposal ${proposal.proposal_id}`, tool };
  if (decision.proposal_id !== proposal.proposal_id) return { admissibility: 'DECISION_REQUIRED', reason: 'decision object is bound to a different proposal', tool };
  if (decision.decision !== 'ALLOW') return { admissibility: 'DENIED_BY_DECISION', reason: `human decision ${decision.decision_id} denied`, tool };
  if (tool.required_authority === 'HUMAN_AUTHORITY' && decision.decision_class !== 'HUMAN_AUTHORITY') return { admissibility: 'DECISION_REQUIRED', reason: 'tool requires HUMAN_AUTHORITY; a confirmation is not an authority decision', tool };
  return { admissibility: 'ADMISSIBLE', reason: `admitted by human decision ${decision.decision_id} (${decision.authority_basis})`, tool };
}
