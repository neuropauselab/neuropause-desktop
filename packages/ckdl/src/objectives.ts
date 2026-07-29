/**
 * Purpose Model (NCEA 11.1, Phase 5). First-class Objectives give the platform a
 * sense of WHY. An objective (mission / goal / objective) carries measurable key
 * results and KPIs, an owner, dependencies on other objectives, and links to the
 * projects, tasks, AI employees, decisions, and documents that serve it. Progress
 * is DERIVED from key results — never hand-set — so it can't drift from reality.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { EntityRef } from './entities';
import { refKey } from './entities';
import { clamp01 } from './util';
import type { KnowledgeGovernance } from './governance';

export type ObjectiveKind = 'mission' | 'goal' | 'objective';

export interface KeyResult {
  id: string;
  description: string;
  target: number;
  current: number;
  unit?: string;
}

export interface Kpi {
  name: string;
  target: number;
  current: number;
  unit?: string;
}

export interface Objective {
  id: string;
  kind: ObjectiveKind;
  title: string;
  description?: string;
  owner: string;
  keyResults: KeyResult[];
  kpis: Kpi[];
  successMetric?: string;
  dependencyIds: string[];
  linkKeys: string[];
  createdAt: number;
}

export interface CreateObjectiveInput {
  kind: ObjectiveKind;
  title: string;
  owner: string;
  description?: string;
  successMetric?: string;
  keyResults?: Array<Omit<KeyResult, 'id'>>;
  kpis?: Kpi[];
  actor?: string;
}

export class PurposeModel {
  private readonly objectives = new Map<string, Objective>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: KnowledgeGovernance,
  ) {}

  async create(input: CreateObjectiveInput): Promise<Objective> {
    const objective: Objective = {
      id: randomId('obj'),
      kind: input.kind,
      title: input.title,
      owner: input.owner,
      ...(input.description ? { description: input.description } : {}),
      ...(input.successMetric ? { successMetric: input.successMetric } : {}),
      keyResults: (input.keyResults ?? []).map((kr) => ({ ...kr, id: randomId('kr') })),
      kpis: input.kpis ?? [],
      dependencyIds: [],
      linkKeys: [],
      createdAt: this.clock.now(),
    };
    this.objectives.set(objective.id, objective);
    await this.governance.record({
      domain: 'objective',
      action: `create.${input.kind}`,
      entity: objective.id,
      actor: input.actor ?? input.owner,
      ok: true,
      meta: { title: objective.title },
    });
    return objective;
  }

  get(id: string): Objective | undefined {
    return this.objectives.get(id);
  }

  list(kind?: ObjectiveKind): Objective[] {
    const all = [...this.objectives.values()];
    return kind ? all.filter((o) => o.kind === kind) : all;
  }

  async addKeyResult(objectiveId: string, kr: Omit<KeyResult, 'id'>, actor = 'system'): Promise<KeyResult> {
    const objective = this.require(objectiveId);
    const keyResult: KeyResult = { ...kr, id: randomId('kr') };
    objective.keyResults.push(keyResult);
    await this.governance.record({ domain: 'objective', action: 'kr.add', entity: objectiveId, actor, ok: true, meta: { kr: keyResult.description } });
    return keyResult;
  }

  async updateKeyResult(objectiveId: string, keyResultId: string, current: number, actor = 'system'): Promise<Objective> {
    const objective = this.require(objectiveId);
    const kr = objective.keyResults.find((k) => k.id === keyResultId);
    if (!kr) throw new Error(`key result '${keyResultId}' not found`);
    kr.current = current;
    await this.governance.record({ domain: 'objective', action: 'kr.update', entity: objectiveId, actor, ok: true, meta: { keyResultId, current } });
    return objective;
  }

  async link(objectiveId: string, ref: EntityRef, actor = 'system'): Promise<Objective> {
    const objective = this.require(objectiveId);
    const key = refKey(ref);
    if (!objective.linkKeys.includes(key)) objective.linkKeys.push(key);
    await this.governance.record({ domain: 'objective', action: `link.${ref.kind}`, entity: objectiveId, actor, ok: true, meta: { link: key } });
    return objective;
  }

  async addDependency(objectiveId: string, dependsOnId: string, actor = 'system'): Promise<Objective> {
    const objective = this.require(objectiveId);
    this.require(dependsOnId);
    if (objectiveId === dependsOnId) throw new Error('an objective cannot depend on itself');
    if (this.dependsOnTransitively(dependsOnId, objectiveId)) throw new Error('dependency would create a cycle');
    if (!objective.dependencyIds.includes(dependsOnId)) objective.dependencyIds.push(dependsOnId);
    await this.governance.record({ domain: 'objective', action: 'dependency.add', entity: objectiveId, actor, ok: true, meta: { dependsOnId } });
    return objective;
  }

  private dependsOnTransitively(objectiveId: string, target: string): boolean {
    const seen = new Set<string>();
    const stack = [objectiveId];
    while (stack.length) {
      const current = stack.pop()!;
      if (current === target) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      const objective = this.objectives.get(current);
      if (objective) stack.push(...objective.dependencyIds);
    }
    return false;
  }

  /** Progress derived from key results: mean of clamped current/target ratios. */
  progress(objectiveId: string): number {
    const objective = this.require(objectiveId);
    if (objective.keyResults.length === 0) return 0;
    const ratios = objective.keyResults.map((kr) => (kr.target > 0 ? clamp01(kr.current / kr.target) : 0));
    return ratios.reduce((a, b) => a + b, 0) / ratios.length;
  }

  /** Overall progress across a set (or all) objectives. */
  rollup(kind?: ObjectiveKind): { count: number; progress: number } {
    const list = this.list(kind);
    if (list.length === 0) return { count: 0, progress: 0 };
    const progress = list.reduce((s, o) => s + this.progress(o.id), 0) / list.length;
    return { count: list.length, progress };
  }

  private require(id: string): Objective {
    const objective = this.objectives.get(id);
    if (!objective) throw new Error(`objective '${id}' not found`);
    return objective;
  }
}
