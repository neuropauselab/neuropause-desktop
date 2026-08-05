/**
 * Repository set (NCEA 12.0, Phase 2/3/10). One durable repository per service
 * table — operational (organizations, users, AI employees, workspaces, projects,
 * tasks, policies, connectors, sessions, runtime metadata) and knowledge (CKDL
 * entities, relationships, decisions, evidence, objectives, trust inputs). Each is
 * a `TableRepository` with the same get/list/insert/update/upsert shape the
 * in-memory registries expose, so a subsystem is rebound to durable storage
 * WITHOUT changing its runtime API. CKDL entities use their entity key as the row
 * id, so `upsert` is idempotent — references, never duplicated.
 */
import type { Clock } from '@neuropause/cloud-core';
import type { SqlExecutor } from './driver';
import { TableRepository, type Entity } from './repository';

/** A persisted record is any object with a stable string id (its business key). */
export type Record_ = Entity & Record<string, unknown>;

export interface RepositorySet {
  // operational
  organizations: TableRepository<Record_>;
  users: TableRepository<Record_>;
  aiEmployees: TableRepository<Record_>;
  workspaces: TableRepository<Record_>;
  projects: TableRepository<Record_>;
  tasks: TableRepository<Record_>;
  policies: TableRepository<Record_>;
  connectors: TableRepository<Record_>;
  sessions: TableRepository<Record_>;
  runtimeMetadata: TableRepository<Record_>;
  // knowledge (CKDL)
  ckdlEntities: TableRepository<Record_>;
  ckdlRelationships: TableRepository<Record_>;
  ckdlDecisions: TableRepository<Record_>;
  ckdlEvidence: TableRepository<Record_>;
  ckdlObjectives: TableRepository<Record_>;
  ckdlTrustInputs: TableRepository<Record_>;
}

export function createRepositories(exec: SqlExecutor, clock: Clock): RepositorySet {
  const r = (table: string): TableRepository<Record_> => new TableRepository<Record_>(exec, table, clock);
  return {
    organizations: r('organizations'),
    users: r('users'),
    aiEmployees: r('ai_employees'),
    workspaces: r('workspaces'),
    projects: r('projects'),
    tasks: r('tasks'),
    policies: r('policies'),
    connectors: r('connectors'),
    sessions: r('sessions'),
    runtimeMetadata: r('runtime_metadata'),
    ckdlEntities: r('ckdl_entities'),
    ckdlRelationships: r('ckdl_relationships'),
    ckdlDecisions: r('ckdl_decisions'),
    ckdlEvidence: r('ckdl_evidence'),
    ckdlObjectives: r('ckdl_objectives'),
    ckdlTrustInputs: r('ckdl_trust_inputs'),
  };
}
