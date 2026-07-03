/**
 * Prompt Manager. A registry of versioned prompts. Each prompt has a stable id, a
 * monotonically increasing version, a system template and a user template, and a
 * list of expected variables. Templates interpolate {{variable}} tokens. History
 * is retained so an audit record's promptVersion always resolves to its exact
 * text.
 */

export interface PromptTemplate {
  id: string;
  version: number;
  /** Human label for the surface this prompt serves. */
  label: string;
  system: string;
  user: string;
  /** Variable names the templates expect. */
  variables: string[];
}

export interface RenderedPrompt {
  id: string;
  version: number;
  system: string;
  user: string;
}

export class PromptManager {
  /** id → versions (ascending). */
  private readonly registry = new Map<string, PromptTemplate[]>();

  constructor(seed: PromptTemplate[] = DEFAULT_PROMPTS) {
    for (const p of seed) this.register(p);
  }

  register(p: PromptTemplate): void {
    const list = this.registry.get(p.id) ?? [];
    list.push(p);
    list.sort((a, b) => a.version - b.version);
    this.registry.set(p.id, list);
  }

  /** Latest version of a prompt. */
  get(id: string): PromptTemplate {
    const list = this.registry.get(id);
    const latest = list && list.length > 0 ? list[list.length - 1] : undefined;
    if (!latest) throw new Error(`Unknown prompt: ${id}`);
    return latest;
  }

  /** A specific version (for reproducing an audited call). */
  getVersion(id: string, version: number): PromptTemplate {
    const found = (this.registry.get(id) ?? []).find((p) => p.version === version);
    if (!found) throw new Error(`Unknown prompt version: ${id}@${version}`);
    return found;
  }

  history(id: string): PromptTemplate[] {
    return [...(this.registry.get(id) ?? [])];
  }

  /** Render the latest version with variables interpolated. */
  render(id: string, variables: Record<string, string> = {}): RenderedPrompt {
    const p = this.get(id);
    return {
      id: p.id,
      version: p.version,
      system: interpolate(p.system, variables),
      user: interpolate(p.user, variables),
    };
  }
}

/** Replace {{name}} with variables[name]; unknown tokens become empty strings. */
export function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => variables[name] ?? '');
}

/**
 * Shared grounding clause. Every prompt instructs the model to ground claims in
 * the provided evidence and to refuse to invent facts — the deterministic data
 * stays authoritative; the model only explains and recommends.
 */
const GROUNDING = [
  'You are part of NeuroPause, an AI operating layer.',
  "You will be given factual CONTEXT assembled from the user's connected systems.",
  'Ground every statement in that context. Never invent facts, numbers, names, or events.',
  'If the context is insufficient, say so plainly rather than guessing.',
  'Cite evidence by echoing the provided evidence ids.',
].join(' ');

/** Seed prompt registry (versioned). New revisions are added with a higher version. */
export const DEFAULT_PROMPTS: PromptTemplate[] = [
  {
    id: 'system.base',
    version: 1,
    label: 'System Prompt',
    system: GROUNDING,
    user: '',
    variables: [],
  },
  {
    id: 'engineering.summary',
    version: 1,
    label: 'Engineering AI',
    system: `${GROUNDING} You are the Engineering AI. Analyze CI failures, open pull requests, releases, and the knowledge graph. Respond ONLY with a JSON object with keys: rootCause (string), engineeringRisk (string), recommendedAction (string), businessImpact (string), confidence (number 0..1), evidence (array of {kind,id}).`,
    user: 'CONTEXT:\n{{context}}\n\nTask: Summarize the current engineering health for {{subject}} and recommend the single most important action.',
    variables: ['context', 'subject'],
  },
  {
    id: 'founder.answer',
    version: 1,
    label: 'Founder AI',
    system: `${GROUNDING} You are the Founder AI answering an executive question. Respond ONLY with a JSON object: answer (string), supporting (array of strings), confidence (number 0..1), evidence (array of {kind,id}).`,
    user: 'CONTEXT:\n{{context}}\n\nExecutive question: {{question}}',
    variables: ['context', 'question'],
  },
  {
    id: 'founder.executive',
    version: 1,
    label: 'Founder AI — Executive',
    system: `${GROUNDING} You are the Founder AI, NeuroPause's executive intelligence interface — not a chatbot. A founder is asking a strategic question classified as intent "{{intent}}". You are given deterministic KEY FINDINGS (already verified facts — never alter, contradict, or add to them) and supporting CONTEXT. Write a concise executive answer strictly from those. Respond ONLY with a JSON object with keys: executiveSummary (string), businessImpact (string), recommendations (array of strings — advisory next steps), confidence (number 0..1), evidence (array of {kind,id} echoed from what you used). If the findings and context are insufficient to answer responsibly, set executiveSummary to a brief honest statement that there is not enough evidence to answer confidently, leave recommendations empty, and set confidence to 0.2 or lower.`,
    user: 'KEY FINDINGS (authoritative, deterministic):\n{{findings}}\n\nCONTEXT:\n{{context}}\n\nExecutive question: {{question}}',
    variables: ['intent', 'findings', 'context', 'question'],
  },
  {
    id: 'brief.executive-summary',
    version: 1,
    label: 'Mission Brief — Executive Summary',
    system: `${GROUNDING} You write the executive narrative for a daily briefing whose facts are already computed deterministically. Do not add facts; explain what the provided sections mean. Respond ONLY with JSON: executiveSummary (string), recommendations (array of strings), riskExplanation (string), nextActions (array of strings), confidence (number 0..1).`,
    user: 'BRIEFING SECTIONS (authoritative facts):\n{{context}}\n\nWrite the executive summary, recommendations, a short risk explanation, and suggested next actions — strictly from the sections above.',
    variables: ['context'],
  },
  {
    id: 'generic.summary',
    version: 1,
    label: 'Summary Prompt',
    system: `${GROUNDING} Summarize the provided context concisely. Respond ONLY with JSON: summary (string), confidence (number 0..1).`,
    user: 'CONTEXT:\n{{context}}\n\nSummarize.',
    variables: ['context'],
  },
];
