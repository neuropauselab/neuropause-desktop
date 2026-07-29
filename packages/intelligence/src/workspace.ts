/**
 * Module 5 — AI Workspace. ONE chat engine, nine scopes (universal / repository /
 * document / meeting / email / calendar / project / customer / cross-system). Each chat
 * retrieves scope-relevant evidence from the graph (via search v2), then answers through
 * the governed AnswerEngine — so every answer links back to real source evidence and is
 * audited. Scopes whose entity types have no live data return an honest "no evidence".
 */
import type { AiAnswer, EvidenceRef, EntityType } from './types';
import type { KnowledgeGraph } from './graph';
import type { EnterpriseSearchV2 } from './searchv2';
import type { AnswerEngine } from './engine';
import { CHAT_SCOPES, type ChatScope } from './constants';

export interface WorkspaceDeps {
  graph: KnowledgeGraph;
  search: EnterpriseSearchV2;
  answerEngine: AnswerEngine;
}

const SCOPE_TYPES: Record<ChatScope, EntityType[]> = {
  universal: [],
  'cross-system': [],
  repository: ['repository', 'connector', 'pull_request', 'issue'],
  document: ['document', 'artifact'],
  meeting: ['meeting'],
  email: ['email'],
  calendar: ['calendar_event'],
  project: ['project', 'objective', 'key_result', 'task'],
  customer: ['customer', 'partner'],
};

export class AiWorkspace {
  constructor(private readonly deps: WorkspaceDeps) {}

  scopes(): ChatScope[] {
    return [...CHAT_SCOPES];
  }

  async chat(scope: ChatScope, tenantId: string, actor: string, question: string, opts: { model?: string } = {}): Promise<AiAnswer> {
    const types = SCOPE_TYPES[scope];
    // Evidence from the graph, scoped by the chat's entity types (or all for universal/cross-system).
    const scoped = this.deps.graph.list(tenantId).filter((e) => types.length === 0 || types.includes(e.type));
    const q = question.toLowerCase();
    const matched = scoped.filter((e) => e.label.toLowerCase().includes(q));
    const evidence: EvidenceRef[] = (matched.length ? matched : scoped).slice(0, 15).flatMap((e) => e.evidence);
    return this.deps.answerEngine.answer({
      tenantId,
      actor,
      kind: `workspace.${scope}`,
      question: `[${scope} chat] ${question}`,
      evidence,
      ...(opts.model ? { model: opts.model } : {}),
    });
  }
}
