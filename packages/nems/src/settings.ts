/**
 * Settings Platform (Wave 1, Module 6). Persisted settings at profile /
 * organization / workspace scope (notifications, appearance, localization,
 * security, API-keys placeholder, audit preferences) plus per-user preferences.
 * Upserted, tenant-scoped, audited + published (nems.settings.changed).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { SqlDriver } from '@neuropause/persistence';
import { one, many, run, toJson } from './db';
import { recordMutation, type Gov } from './governance';
import type { MutationContext } from './types';

export type SettingScope = 'profile' | 'organization' | 'workspace';
export const SETTING_CATEGORIES = ['notifications', 'appearance', 'localization', 'security', 'api-keys', 'audit'] as const;
export type SettingCategory = (typeof SETTING_CATEGORIES)[number];

export class SettingsService {
  constructor(private readonly db: SqlDriver, private readonly clock: Clock, private readonly gov: Gov) {}

  async set(ctx: MutationContext, input: { scope: SettingScope; category: SettingCategory | string; data: Record<string, unknown>; ownerId?: string }): Promise<void> {
    const owner = input.ownerId ?? '';
    const at = this.clock.now();
    await run(this.db, `INSERT INTO nems_settings (id, tenant_id, scope, owner_id, category, data, updated_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT (tenant_id, scope, owner_id, category) DO UPDATE SET data=$6::jsonb, updated_at=$7`,
      [randomId('set'), ctx.tenantId, input.scope, owner, input.category, toJson(input.data), at]);
    await recordMutation(this.gov, { ctx, entity: 'settings', entityId: `${input.scope}:${owner}:${input.category}`, operation: 'update', after: { category: input.category }, event: 'nems.settings.changed' });
  }
  async get(tenantId: string, scope: SettingScope, category: SettingCategory | string, ownerId?: string): Promise<Record<string, unknown> | undefined> {
    const r = await one<{ data: Record<string, unknown> }>(this.db, `SELECT data FROM nems_settings WHERE tenant_id=$1 AND scope=$2 AND owner_id=$3 AND category=$4`, [tenantId, scope, ownerId ?? '', category]);
    return r?.data;
  }
  async list(tenantId: string, scope?: SettingScope): Promise<Array<{ scope: string; category: string; data: Record<string, unknown> }>> {
    const rows = scope
      ? await many<{ scope: string; category: string; data: Record<string, unknown> }>(this.db, `SELECT scope,category,data FROM nems_settings WHERE tenant_id=$1 AND scope=$2`, [tenantId, scope])
      : await many<{ scope: string; category: string; data: Record<string, unknown> }>(this.db, `SELECT scope,category,data FROM nems_settings WHERE tenant_id=$1`, [tenantId]);
    return rows.map((r) => ({ scope: r.scope, category: r.category, data: r.data ?? {} }));
  }

  /** API keys — placeholder in Wave 1 (real key issuance is a later wave). */
  async apiKeysPlaceholder(ctx: MutationContext): Promise<void> {
    await this.set(ctx, { scope: 'workspace', category: 'api-keys', data: { enabled: false, note: 'API key issuance is a later wave' } });
  }

  // ── per-user preferences (theme, layout, locale) ──
  async setPreferences(ctx: MutationContext, userId: string, data: Record<string, unknown>): Promise<void> {
    const at = this.clock.now();
    await run(this.db, `INSERT INTO nems_preferences (id, tenant_id, user_id, data, updated_at) VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET data=$4::jsonb, updated_at=$5`, [randomId('pref'), ctx.tenantId, userId, toJson(data), at]);
    await recordMutation(this.gov, { ctx, entity: 'preferences', entityId: userId, operation: 'update', after: { keys: Object.keys(data) }, event: 'nems.settings.changed' });
  }
  async preferences(tenantId: string, userId: string): Promise<Record<string, unknown>> {
    const r = await one<{ data: Record<string, unknown> }>(this.db, `SELECT data FROM nems_preferences WHERE tenant_id=$1 AND user_id=$2`, [tenantId, userId]);
    return r?.data ?? {};
  }
}
