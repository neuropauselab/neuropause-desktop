/**
 * Knowledge Platform (NCEA 10.5, Phase 6). ONE knowledge graph: documents,
 * notes, meeting records, and scoped memory (conversation / workspace /
 * organization) are all typed nodes; links, references, and entity mentions are
 * typed edges. Every node keeps full version history. `search()` is the semantic
 * search INTERFACE with a deterministic keyword-scoring mock behind it — a real
 * embedding backend implements the same signature but needs a vector store +
 * model and is NOT included here. Edits are governed.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';

export const KNOWLEDGE_NODE_TYPES = ['document', 'note', 'meeting', 'memory', 'entity'] as const;
export type KnowledgeNodeType = (typeof KNOWLEDGE_NODE_TYPES)[number];

export const MEMORY_SCOPES = ['conversation', 'workspace', 'organization'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const EDGE_TYPES = ['links-to', 'references', 'mentions', 'derived-from', 'relates-to'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export interface KnowledgeVersion {
  version: number;
  title: string;
  body: string;
  at: number;
  actor: string;
}

export interface KnowledgeNode {
  id: string;
  type: KnowledgeNodeType;
  title: string;
  body: string;
  workspaceId?: string;
  orgId?: string;
  scope?: MemoryScope;
  scopeKey?: string;
  tags: string[];
  version: number;
  history: KnowledgeVersion[];
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  at: number;
}

export interface AddNodeInput {
  type: KnowledgeNodeType;
  title: string;
  body?: string;
  workspaceId?: string;
  orgId?: string;
  tags?: string[];
  actor?: string;
}

export interface SearchResult {
  node: KnowledgeNode;
  score: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

export class KnowledgeGraph {
  private readonly nodes = new Map<string, KnowledgeNode>();
  private readonly edges = new Map<string, KnowledgeEdge>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async add(input: AddNodeInput): Promise<KnowledgeNode> {
    const now = this.clock.now();
    const node: KnowledgeNode = {
      id: randomId('kn'),
      type: input.type,
      title: input.title,
      body: input.body ?? '',
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.orgId ? { orgId: input.orgId } : {}),
      tags: input.tags ?? [],
      version: 1,
      history: [{ version: 1, title: input.title, body: input.body ?? '', at: now, actor: input.actor ?? 'system' }],
      createdAt: now,
      updatedAt: now,
    };
    this.nodes.set(node.id, node);
    await this.governance.record({
      domain: 'knowledge',
      action: `add.${input.type}`,
      entity: node.id,
      actor: input.actor ?? 'system',
      ...(input.workspaceId ? { workspace: input.workspaceId } : {}),
      ...(input.orgId ? { org: input.orgId } : {}),
      approval: 'not-required',
      ok: true,
      meta: { title: node.title },
    });
    return node;
  }

  get(id: string): KnowledgeNode | undefined {
    return this.nodes.get(id);
  }

  list(filter: { type?: KnowledgeNodeType; workspaceId?: string } = {}): KnowledgeNode[] {
    return [...this.nodes.values()].filter(
      (n) =>
        (filter.type === undefined || n.type === filter.type) &&
        (filter.workspaceId === undefined || n.workspaceId === filter.workspaceId),
    );
  }

  async update(id: string, patch: { title?: string; body?: string; tags?: string[] }, actor = 'system'): Promise<KnowledgeNode> {
    const node = this.require(id);
    node.title = patch.title ?? node.title;
    node.body = patch.body ?? node.body;
    if (patch.tags) node.tags = patch.tags;
    node.version += 1;
    node.updatedAt = this.clock.now();
    node.history.push({ version: node.version, title: node.title, body: node.body, at: node.updatedAt, actor });
    await this.governance.record({
      domain: 'knowledge',
      action: 'update',
      entity: id,
      actor,
      ...(node.workspaceId ? { workspace: node.workspaceId } : {}),
      approval: 'not-required',
      ok: true,
      meta: { version: node.version },
    });
    return node;
  }

  versions(id: string): KnowledgeVersion[] {
    return [...this.require(id).history];
  }

  // --- graph edges ----------------------------------------------------------
  async link(from: string, to: string, type: EdgeType, actor = 'system'): Promise<KnowledgeEdge> {
    this.require(from);
    this.require(to);
    const edge: KnowledgeEdge = { id: randomId('ke'), from, to, type, at: this.clock.now() };
    this.edges.set(edge.id, edge);
    await this.governance.record({
      domain: 'knowledge',
      action: `link.${type}`,
      entity: from,
      actor,
      approval: 'not-required',
      ok: true,
      meta: { to, type },
    });
    return edge;
  }

  edgesOf(id: string): KnowledgeEdge[] {
    return [...this.edges.values()].filter((e) => e.from === id || e.to === id);
  }

  neighbors(id: string): KnowledgeNode[] {
    const ids = new Set<string>();
    for (const edge of this.edgesOf(id)) ids.add(edge.from === id ? edge.to : edge.from);
    return [...ids].map((n) => this.nodes.get(n)).filter((n): n is KnowledgeNode => Boolean(n));
  }

  // --- memory scopes --------------------------------------------------------
  async remember(
    scope: MemoryScope,
    key: string,
    value: string,
    options: { workspaceId?: string; orgId?: string; actor?: string } = {},
  ): Promise<KnowledgeNode> {
    const now = this.clock.now();
    const node: KnowledgeNode = {
      id: randomId('mem'),
      type: 'memory',
      title: key,
      body: value,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      ...(options.orgId ? { orgId: options.orgId } : {}),
      scope,
      scopeKey: key,
      tags: ['memory', scope],
      version: 1,
      history: [{ version: 1, title: key, body: value, at: now, actor: options.actor ?? 'system' }],
      createdAt: now,
      updatedAt: now,
    };
    this.nodes.set(node.id, node);
    await this.governance.record({
      domain: 'knowledge',
      action: `memory.${scope}`,
      entity: node.id,
      actor: options.actor ?? 'system',
      ...(options.workspaceId ? { workspace: options.workspaceId } : {}),
      ...(options.orgId ? { org: options.orgId } : {}),
      approval: 'not-required',
      ok: true,
      meta: { key },
    });
    return node;
  }

  recall(scope: MemoryScope, key: string): KnowledgeNode | undefined {
    // Latest by updatedAt; ties broken by insertion order (Map is insertion-ordered,
    // so `>=` lets a later write win even when the clock has not advanced).
    let best: KnowledgeNode | undefined;
    for (const node of this.nodes.values()) {
      if (node.type !== 'memory' || node.scope !== scope || node.scopeKey !== key) continue;
      if (!best || node.updatedAt >= best.updatedAt) best = node;
    }
    return best;
  }

  // --- semantic search INTERFACE (deterministic keyword mock) ---------------
  search(query: string, options: { type?: KnowledgeNodeType; workspaceId?: string; limit?: number } = {}): SearchResult[] {
    const terms = tokenize(query);
    if (!terms.length) return [];
    const scored: SearchResult[] = [];
    for (const node of this.list({ ...(options.type ? { type: options.type } : {}), ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}) })) {
      const haystack = tokenize(`${node.title} ${node.body} ${node.tags.join(' ')}`);
      const set = new Set(haystack);
      const overlap = terms.filter((t) => set.has(t)).length;
      if (overlap > 0) scored.push({ node, score: overlap / terms.length });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, options.limit ?? 10);
  }

  private require(id: string): KnowledgeNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`knowledge node '${id}' not found`);
    return node;
  }
}
