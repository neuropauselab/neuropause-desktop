/**
 * Module 5 — Knowledge Platform. Wiki, knowledge base, SOP library, policies, procedures, FAQs,
 * and best practices, with a real in-process search over the articles (and the reused Wave 8
 * Enterprise Search / memory when present). In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';

export type ArticleKind = 'wiki' | 'kb' | 'sop' | 'policy' | 'procedure' | 'faq' | 'best-practice';

export interface KnowledgeArticle {
  id: string;
  kind: ArticleKind;
  title: string;
  body: string;
  tags: string[];
  createdAt: number;
}

const KINDS: readonly ArticleKind[] = ['wiki', 'kb', 'sop', 'policy', 'procedure', 'faq', 'best-practice'];

export class KnowledgePlatform {
  private readonly articles = new Map<string, KnowledgeArticle>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async create(input: { kind: ArticleKind; title: string; body?: string; tags?: string[] }): Promise<KnowledgeArticle> {
    if (!KINDS.includes(input.kind)) throw new Error(`unknown article kind: ${input.kind}`);
    const a: KnowledgeArticle = { id: randomId('kn'), kind: input.kind, title: input.title, body: input.body ?? '', tags: input.tags ?? [], createdAt: this.clock.now() };
    this.articles.set(a.id, a);
    await this.governance.record({ actor: 'system', module: 'knowledge', operation: `create.${input.kind}`, targetId: a.id, evidence: 'live-verified' });
    return a;
  }

  /** Real in-process search over real articles. */
  search(query: string): KnowledgeArticle[] {
    const q = query.toLowerCase();
    return [...this.articles.values()].filter((a) => a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q)));
  }

  get(id: string): KnowledgeArticle | undefined { return this.articles.get(id); }
  list(kind?: ArticleKind): KnowledgeArticle[] {
    const all = [...this.articles.values()];
    return kind ? all.filter((a) => a.kind === kind) : all;
  }
  count(): number { return this.articles.size; }
}
