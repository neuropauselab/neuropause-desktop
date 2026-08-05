/**
 * OKR Platform (Wave 1, Module 5). Persisted objectives, key results, projects,
 * milestones, tasks, and dependencies with progress, evidence, status, ownership,
 * risk, and annual/quarterly planning. Objective progress is computed from its key
 * results. Tenant-scoped; every mutation audited + published (nems.okr.updated).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { SqlDriver } from '@neuropause/persistence';
import { one, many, run, toJson } from './db';
import { recordMutation, type Gov } from './governance';
import type { MutationContext } from './types';

export type OkrStatus = 'planned' | 'on-track' | 'at-risk' | 'behind' | 'done' | 'external';
export interface Objective {
  id: string; tenantId: string; title: string; description: string | null; ownerId: string | null;
  period: string; level: 'annual' | 'quarterly'; status: OkrStatus; progress: number; risk: string | null; parentId: string | null;
  createdAt: number; updatedAt: number;
}
export interface KeyResult {
  id: string; objectiveId: string; title: string; metric: string | null; target: number | null; current: number;
  status: string; progress: number; evidence: string[];
}
const num = (v: string | number): number => (typeof v === 'number' ? v : Number(v));
interface ObjRow { id: string; tenant_id: string; title: string; description: string | null; owner_id: string | null; period: string; level: 'annual' | 'quarterly'; status: OkrStatus; progress: string | number; risk: string | null; parent_id: string | null; created_at: string | number; updated_at: string | number; }
function mapObj(r: ObjRow): Objective {
  return { id: r.id, tenantId: r.tenant_id, title: r.title, description: r.description, ownerId: r.owner_id, period: r.period, level: r.level, status: r.status, progress: num(r.progress), risk: r.risk, parentId: r.parent_id, createdAt: num(r.created_at), updatedAt: num(r.updated_at) };
}

export class OkrService {
  constructor(private readonly db: SqlDriver, private readonly clock: Clock, private readonly gov: Gov) {}

  async createObjective(ctx: MutationContext, input: { title: string; period: string; level?: 'annual' | 'quarterly'; description?: string; ownerId?: string; risk?: string; parentId?: string }): Promise<Objective> {
    const id = randomId('obj');
    const at = this.clock.now();
    await run(this.db, `INSERT INTO nems_objectives (id, tenant_id, title, description, owner_id, period, level, status, progress, risk, parent_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'planned',0,$8,$9,$10,$10)`,
      [id, ctx.tenantId, input.title, input.description ?? null, input.ownerId ?? null, input.period, input.level ?? 'quarterly', input.risk ?? null, input.parentId ?? null, at]);
    await recordMutation(this.gov, { ctx, entity: 'objective', entityId: id, operation: 'create', after: { title: input.title, period: input.period }, event: 'nems.okr.updated' });
    return (await this.getObjective(ctx.tenantId, id))!;
  }
  async getObjective(tenantId: string, id: string): Promise<Objective | undefined> {
    const r = await one<ObjRow>(this.db, `SELECT * FROM nems_objectives WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    return r ? mapObj(r) : undefined;
  }
  async objectives(tenantId: string, filter: { period?: string; level?: 'annual' | 'quarterly' } = {}): Promise<Objective[]> {
    const clauses = ['tenant_id=$1']; const params: unknown[] = [tenantId];
    if (filter.period) { params.push(filter.period); clauses.push(`period=$${params.length}`); }
    if (filter.level) { params.push(filter.level); clauses.push(`level=$${params.length}`); }
    return (await many<ObjRow>(this.db, `SELECT * FROM nems_objectives WHERE ${clauses.join(' AND ')} ORDER BY created_at`, params)).map(mapObj);
  }
  async setObjectiveStatus(ctx: MutationContext, id: string, status: OkrStatus): Promise<Objective> {
    const before = await this.getObjective(ctx.tenantId, id);
    await run(this.db, `UPDATE nems_objectives SET status=$3, updated_at=$4 WHERE tenant_id=$1 AND id=$2`, [ctx.tenantId, id, status, this.clock.now()]);
    await recordMutation(this.gov, { ctx, entity: 'objective', entityId: id, operation: 'update', before: { status: before?.status }, after: { status }, event: 'nems.okr.updated' });
    return (await this.getObjective(ctx.tenantId, id))!;
  }

  async addKeyResult(ctx: MutationContext, objectiveId: string, input: { title: string; metric?: string; target?: number }): Promise<KeyResult> {
    const id = randomId('kr');
    const at = this.clock.now();
    await run(this.db, `INSERT INTO nems_key_results (id, tenant_id, objective_id, title, metric, target, current, status, progress, evidence, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,0,'on-track',0,'[]'::jsonb,$7,$7)`,
      [id, ctx.tenantId, objectiveId, input.title, input.metric ?? null, input.target ?? null, at]);
    await recordMutation(this.gov, { ctx, entity: 'key_result', entityId: id, operation: 'create', after: { title: input.title, objectiveId }, event: 'nems.okr.updated' });
    return (await this.keyResult(ctx.tenantId, id))!;
  }
  async keyResult(tenantId: string, id: string): Promise<KeyResult | undefined> {
    const r = await one<{ id: string; objective_id: string; title: string; metric: string | null; target: string | number | null; current: string | number; status: string; progress: string | number; evidence: string[] }>(this.db, `SELECT id,objective_id,title,metric,target,current,status,progress,evidence FROM nems_key_results WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    return r ? { id: r.id, objectiveId: r.objective_id, title: r.title, metric: r.metric, target: r.target == null ? null : num(r.target), current: num(r.current), status: r.status, progress: num(r.progress), evidence: r.evidence ?? [] } : undefined;
  }
  async keyResults(tenantId: string, objectiveId: string): Promise<KeyResult[]> {
    const rows = await many<{ id: string }>(this.db, `SELECT id FROM nems_key_results WHERE tenant_id=$1 AND objective_id=$2 ORDER BY created_at`, [tenantId, objectiveId]);
    const out: KeyResult[] = [];
    for (const r of rows) out.push((await this.keyResult(tenantId, r.id))!);
    return out;
  }
  async updateKeyResult(ctx: MutationContext, krId: string, patch: { current?: number; progress?: number; status?: string; addEvidence?: string }): Promise<KeyResult> {
    const before = await this.keyResult(ctx.tenantId, krId);
    if (!before) throw new Error(`key result '${krId}' not found`);
    const evidence = patch.addEvidence ? [...before.evidence, patch.addEvidence] : before.evidence;
    const progress = patch.progress ?? before.progress;
    await run(this.db, `UPDATE nems_key_results SET current=$3, progress=$4, status=$5, evidence=$6::jsonb, updated_at=$7 WHERE tenant_id=$1 AND id=$2`,
      [ctx.tenantId, krId, patch.current ?? before.current, progress, patch.status ?? before.status, toJson(evidence), this.clock.now()]);
    await this.recomputeProgress(ctx, before.objectiveId);
    await recordMutation(this.gov, { ctx, entity: 'key_result', entityId: krId, operation: 'update', before: { progress: before.progress }, after: { progress }, event: 'nems.okr.updated' });
    return (await this.keyResult(ctx.tenantId, krId))!;
  }
  private async recomputeProgress(ctx: MutationContext, objectiveId: string): Promise<void> {
    const krs = await this.keyResults(ctx.tenantId, objectiveId);
    const avg = krs.length ? Math.round(krs.reduce((a, k) => a + k.progress, 0) / krs.length) : 0;
    await run(this.db, `UPDATE nems_objectives SET progress=$3, updated_at=$4 WHERE tenant_id=$1 AND id=$2`, [ctx.tenantId, objectiveId, avg, this.clock.now()]);
  }

  async createProject(ctx: MutationContext, input: { name: string; objectiveId?: string; ownerId?: string }): Promise<{ id: string }> {
    const id = randomId('proj');
    const at = this.clock.now();
    await run(this.db, `INSERT INTO nems_projects (id, tenant_id, objective_id, name, status, owner_id, created_at, updated_at) VALUES ($1,$2,$3,$4,'active',$5,$6,$6)`, [id, ctx.tenantId, input.objectiveId ?? null, input.name, input.ownerId ?? null, at]);
    await recordMutation(this.gov, { ctx, entity: 'project', entityId: id, operation: 'create', after: { name: input.name }, event: 'nems.okr.updated' });
    return { id };
  }
  async createMilestone(ctx: MutationContext, input: { title: string; projectId?: string; objectiveId?: string; dueAt?: number }): Promise<{ id: string }> {
    const id = randomId('ms');
    const at = this.clock.now();
    await run(this.db, `INSERT INTO nems_milestones (id, tenant_id, project_id, objective_id, title, due_at, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$7)`, [id, ctx.tenantId, input.projectId ?? null, input.objectiveId ?? null, input.title, input.dueAt ?? null, at]);
    await recordMutation(this.gov, { ctx, entity: 'milestone', entityId: id, operation: 'create', after: { title: input.title }, event: 'nems.okr.updated' });
    return { id };
  }
  async createTask(ctx: MutationContext, input: { title: string; projectId?: string; objectiveId?: string; assigneeId?: string }): Promise<{ id: string }> {
    const id = randomId('task');
    const at = this.clock.now();
    await run(this.db, `INSERT INTO nems_tasks (id, tenant_id, project_id, objective_id, title, assignee_id, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'todo',$7,$7)`, [id, ctx.tenantId, input.projectId ?? null, input.objectiveId ?? null, input.title, input.assigneeId ?? null, at]);
    await recordMutation(this.gov, { ctx, entity: 'task', entityId: id, operation: 'create', after: { title: input.title }, event: 'nems.okr.updated' });
    return { id };
  }
  async setTaskStatus(ctx: MutationContext, id: string, status: 'todo' | 'in-progress' | 'blocked' | 'done'): Promise<void> {
    await run(this.db, `UPDATE nems_tasks SET status=$3, updated_at=$4 WHERE tenant_id=$1 AND id=$2`, [ctx.tenantId, id, status, this.clock.now()]);
    await recordMutation(this.gov, { ctx, entity: 'task', entityId: id, operation: 'update', after: { status }, event: 'nems.okr.updated' });
  }
  async addDependency(ctx: MutationContext, input: { fromType: string; fromId: string; toType: string; toId: string; kind?: string }): Promise<{ id: string }> {
    const id = randomId('dep');
    await run(this.db, `INSERT INTO nems_dependencies (id, tenant_id, from_type, from_id, to_type, to_id, kind, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, ctx.tenantId, input.fromType, input.fromId, input.toType, input.toId, input.kind ?? 'blocks', this.clock.now()]);
    await recordMutation(this.gov, { ctx, entity: 'dependency', entityId: id, operation: 'create', after: { from: input.fromId, to: input.toId }, event: 'nems.okr.updated' });
    return { id };
  }
  async tasks(tenantId: string, filter: { status?: string } = {}): Promise<Array<{ id: string; title: string; status: string }>> {
    const rows = filter.status
      ? await many<{ id: string; title: string; status: string }>(this.db, `SELECT id,title,status FROM nems_tasks WHERE tenant_id=$1 AND status=$2 ORDER BY created_at`, [tenantId, filter.status])
      : await many<{ id: string; title: string; status: string }>(this.db, `SELECT id,title,status FROM nems_tasks WHERE tenant_id=$1 ORDER BY created_at`, [tenantId]);
    return rows;
  }
}
