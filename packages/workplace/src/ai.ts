/**
 * Module 14 — Workspace AI. Every employee gets an AI assistant plus document / email / meeting /
 * search / workflow / analytics assistants — all REUSING the Wave 8 Enterprise AI. Grounded only
 * in real objects; returns 'No business data available' when there is nothing to answer from.
 */
import { NO_WORKSPACE_DATA } from './constants';
import type { BusinessPlatform } from './types';

export const WORKSPACE_ASSISTANTS = ['assistant', 'document', 'email', 'meeting', 'search', 'workflow', 'analytics'] as const;
export type WorkspaceAssistant = (typeof WORKSPACE_ASSISTANTS)[number];

export interface AssistantResponse {
  assistant: WorkspaceAssistant;
  answer: string;
  grounded: boolean;
}

export class WorkspaceAI {
  constructor(private readonly business?: BusinessPlatform) {}

  async ask(assistant: WorkspaceAssistant, query: string): Promise<AssistantResponse> {
    if (!this.business) return { assistant, answer: NO_WORKSPACE_DATA, grounded: false };
    if (assistant === 'search') {
      const res = await this.business.intelligence().search(query);
      return { assistant, answer: res.total > 0 ? `${res.total} result(s) found` : NO_WORKSPACE_DATA, grounded: res.total > 0 };
    }
    const res = await this.business.intelligence().copilot(query);
    return { assistant, answer: res.answer, grounded: res.grounded };
  }

  assistants(): readonly WorkspaceAssistant[] {
    return WORKSPACE_ASSISTANTS;
  }
}
