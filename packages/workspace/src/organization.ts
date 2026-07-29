/**
 * Organization Platform (NCEA 10.5, Phase 1). Organizations, business units,
 * departments, teams, groups, locations, and cost centers are modelled as ONE
 * typed hierarchy of OrgNodes — a single tree rather than seven parallel
 * registries. Every structural change is governed (audit + event). This is the
 * skeleton the identity, workforce, task, and knowledge domains hang off of.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';

export const ORG_NODE_TYPES = [
  'organization',
  'business-unit',
  'department',
  'team',
  'group',
  'location',
  'cost-center',
] as const;
export type OrgNodeType = (typeof ORG_NODE_TYPES)[number];

export interface OrgNode {
  id: string;
  type: OrgNodeType;
  name: string;
  parentId?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface CreateOrgNodeInput {
  type: OrgNodeType;
  name: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
  actor?: string;
}

/** Which node types may nest under which — an organization roots the tree. */
const ALLOWED_PARENTS: Record<OrgNodeType, OrgNodeType[] | 'root'> = {
  organization: 'root',
  'business-unit': ['organization'],
  department: ['organization', 'business-unit'],
  // Teams and groups may nest (sub-teams / sub-groups are common); the cycle
  // guard in move() prevents a node from being reparented under its own subtree.
  team: ['team', 'department', 'business-unit', 'organization'],
  group: ['group', 'team', 'department', 'organization'],
  location: ['organization', 'business-unit'],
  'cost-center': ['organization', 'business-unit', 'department'],
};

export class OrganizationRegistry {
  private readonly nodes = new Map<string, OrgNode>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async create(input: CreateOrgNodeInput): Promise<OrgNode> {
    const allowed = ALLOWED_PARENTS[input.type];
    if (allowed === 'root') {
      if (input.parentId) throw new Error(`'${input.type}' is a root node and cannot have a parent`);
    } else {
      if (!input.parentId) throw new Error(`'${input.type}' requires a parent`);
      const parent = this.nodes.get(input.parentId);
      if (!parent) throw new Error(`parent '${input.parentId}' not found`);
      if (!allowed.includes(parent.type)) {
        throw new Error(`'${input.type}' cannot nest under '${parent.type}'`);
      }
    }
    const node: OrgNode = {
      id: randomId(input.type === 'organization' ? 'org' : 'orgn'),
      type: input.type,
      name: input.name,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      metadata: input.metadata ?? {},
      createdAt: this.clock.now(),
    };
    this.nodes.set(node.id, node);
    await this.governance.record({
      domain: 'organization',
      action: `create.${input.type}`,
      entity: node.id,
      actor: input.actor ?? 'system',
      org: this.rootOrg(node)?.id,
      approval: 'not-required',
      ok: true,
      meta: { name: node.name, parentId: node.parentId },
    });
    return node;
  }

  get(id: string): OrgNode | undefined {
    return this.nodes.get(id);
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  list(type?: OrgNodeType): OrgNode[] {
    const all = [...this.nodes.values()];
    return type ? all.filter((n) => n.type === type) : all;
  }

  children(id: string): OrgNode[] {
    return [...this.nodes.values()].filter((n) => n.parentId === id);
  }

  /** Ancestor chain from the node up to (and including) its root organization. */
  path(id: string): OrgNode[] {
    const chain: OrgNode[] = [];
    let cursor = this.nodes.get(id);
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      chain.unshift(cursor);
      cursor = cursor.parentId ? this.nodes.get(cursor.parentId) : undefined;
    }
    return chain;
  }

  /** Every descendant of a node (depth-first), excluding the node itself. */
  subtree(id: string): OrgNode[] {
    const out: OrgNode[] = [];
    const walk = (parentId: string): void => {
      for (const child of this.children(parentId)) {
        out.push(child);
        walk(child.id);
      }
    };
    walk(id);
    return out;
  }

  async move(id: string, newParentId: string, actor = 'system'): Promise<OrgNode> {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`node '${id}' not found`);
    const allowed = ALLOWED_PARENTS[node.type];
    if (allowed === 'root') throw new Error(`'${node.type}' is a root node and cannot be moved`);
    const parent = this.nodes.get(newParentId);
    if (!parent) throw new Error(`parent '${newParentId}' not found`);
    if (!allowed.includes(parent.type)) throw new Error(`'${node.type}' cannot nest under '${parent.type}'`);
    if (id === newParentId || this.subtree(id).some((n) => n.id === newParentId)) {
      throw new Error('cannot move a node under its own descendant');
    }
    node.parentId = newParentId;
    await this.governance.record({
      domain: 'organization',
      action: 'move',
      entity: id,
      actor,
      org: this.rootOrg(node)?.id,
      approval: 'not-required',
      ok: true,
      meta: { newParentId },
    });
    return node;
  }

  private rootOrg(node: OrgNode): OrgNode | undefined {
    const chain = this.path(node.id);
    return chain.find((n) => n.type === 'organization');
  }
}
