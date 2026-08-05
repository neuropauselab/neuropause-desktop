/**
 * Global search (Wave 1, Module 10/11). A basic tenant-scoped cross-entity search
 * over users, objectives, and dashboards — the foundation the richer "one knowledge
 * graph" search expands in a later wave. Read-only; no mutation, no audit.
 */
import type { SqlDriver } from '@neuropause/persistence';
import { many } from './db';

export interface SearchHit {
  type: 'user' | 'objective' | 'dashboard';
  id: string;
  label: string;
}

export class SearchService {
  constructor(private readonly db: SqlDriver) {}

  async search(tenantId: string, query: string, limit = 20): Promise<SearchHit[]> {
    const like = `%${query}%`;
    const users = await many<{ id: string; label: string }>(this.db, `SELECT id, display_name AS label FROM nems_users WHERE tenant_id=$1 AND display_name ILIKE $2 LIMIT $3`, [tenantId, like, limit]);
    const objectives = await many<{ id: string; label: string }>(this.db, `SELECT id, title AS label FROM nems_objectives WHERE tenant_id=$1 AND title ILIKE $2 LIMIT $3`, [tenantId, like, limit]);
    const dashboards = await many<{ id: string; label: string }>(this.db, `SELECT id, name AS label FROM nems_dashboards WHERE tenant_id=$1 AND name ILIKE $2 LIMIT $3`, [tenantId, like, limit]);
    return [
      ...users.map((u) => ({ type: 'user' as const, id: u.id, label: u.label })),
      ...objectives.map((o) => ({ type: 'objective' as const, id: o.id, label: o.label })),
      ...dashboards.map((d) => ({ type: 'dashboard' as const, id: d.id, label: d.label })),
    ];
  }
}
