/**
 * AI Industry Copilots. Each industry gets a copilot, industry knowledge, and document / workflow
 * / analytics / search assistants — all REUSING the Wave 8 Enterprise AI (BusinessIntelligence).
 * The copilot is grounded only in real business objects and returns 'No business data available'
 * when there is nothing to answer from. No new AI is built.
 */
import type { BusinessPlatform } from '@neuropause/business';
import type { IndustrySDK } from './sdk';
import { NO_INDUSTRY_DATA } from './constants';

export interface CopilotResponse {
  industry: string;
  answer: string;
  grounded: boolean;
  skills: string[];
}

export class IndustryCopilots {
  constructor(
    private readonly sdk: IndustrySDK,
    private readonly business?: BusinessPlatform,
  ) {}

  /** Reuses the Wave 8 copilot, scoped to the industry's declared AI skills. */
  async ask(industryKey: string, query: string): Promise<CopilotResponse> {
    const skills = this.skills(industryKey);
    if (!this.business) return { industry: industryKey, answer: NO_INDUSTRY_DATA, grounded: false, skills };
    const res = await this.business.intelligence().copilot(query);
    return { industry: industryKey, answer: res.answer, grounded: res.grounded, skills };
  }

  skills(industryKey: string): string[] {
    return this.sdk.get(industryKey)?.aiSkills.map((s) => s.name) ?? [];
  }
}
