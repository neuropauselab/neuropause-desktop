/**
 * P2.4 — AI drafting for Microsoft 365 (reuses the existing AI engine; NEVER sends or modifies data).
 *
 * Produces text only — a draft email, a summary of a thread/document/Teams discussion, or a meeting agenda —
 * which the user reviews and then explicitly confirms through the write executor. The AI has no path to a
 * mutation: it returns a string; sending is a separate, confirmation-gated action the user triggers.
 */
import type { AiEngineResponse } from '@neuropause/shared';
import { aiEngine } from '../../ai/engineInstance';

export type M365DraftKind = 'email' | 'summary' | 'agenda';

export interface M365DraftResult {
  ok: boolean;
  text: string;
  model: string;
  grounded: boolean;
  confidence: number;
}

const PROMPT_BY_KIND: Record<M365DraftKind, string> = {
  email: 'm365.draft.email',
  summary: 'm365.draft.summary',
  agenda: 'm365.draft.agenda',
};

function draftText(resp: AiEngineResponse): string {
  if (resp.text && resp.text.trim().length > 0) return resp.text;
  const d = resp.data;
  if (d !== null && typeof d === 'object' && 'text' in d) {
    const t = (d as Record<string, unknown>).text;
    if (typeof t === 'string') return t;
  }
  return '';
}

export async function m365Draft(kind: M365DraftKind, instruction: string, context?: string): Promise<M365DraftResult> {
  const resp = await aiEngine.run({
    worker: 'founder',
    promptId: PROMPT_BY_KIND[kind],
    variables: { instruction, material: context ?? '' },
    tier: 'balanced',
  });
  const text = draftText(resp).trim();
  return {
    ok: text.length > 0,
    text: text.length > 0 ? text : 'No draft was generated (the AI model may not be configured). You can still compose manually.',
    model: resp.model,
    grounded: resp.grounded,
    confidence: resp.confidence,
  };
}
