/**
 * Agent lifecycle state machine (V7.0, pure). A single deterministic lifecycle for
 * every AI agent, with an explicit legal-transition table so no agent can enter an
 * inconsistent state. Pure functions only — the runtime drives an agent through
 * these states; this module just decides what's allowed.
 */

export type AgentState =
  | 'idle'
  | 'planning'
  | 'waiting'
  | 'executing'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Legal transitions. Terminal states have none (except `failed`, which may retry). */
const TRANSITIONS: Record<AgentState, readonly AgentState[]> = {
  idle: ['planning', 'cancelled'],
  planning: ['waiting', 'executing', 'failed', 'cancelled'],
  waiting: ['executing', 'failed', 'cancelled'],
  executing: ['waiting', 'reviewing', 'failed', 'cancelled'],
  reviewing: ['executing', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: ['planning', 'cancelled'], // retry or abandon
  cancelled: [],
};

/** States from which no further progress is made. `failed` is recoverable (retry). */
const TERMINAL: ReadonlySet<AgentState> = new Set<AgentState>(['completed', 'cancelled']);

export function canTransition(from: AgentState, to: AgentState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStates(from: AgentState): readonly AgentState[] {
  return TRANSITIONS[from];
}

export function isTerminal(state: AgentState): boolean {
  return TERMINAL.has(state);
}

export type TransitionResult = { ok: true; state: AgentState } | { ok: false; error: string };

/** Apply a transition if legal; otherwise return an error (state unchanged). */
export function transition(from: AgentState, to: AgentState): TransitionResult {
  if (canTransition(from, to)) return { ok: true, state: to };
  return { ok: false, error: `illegal agent transition: ${from} → ${to}` };
}
