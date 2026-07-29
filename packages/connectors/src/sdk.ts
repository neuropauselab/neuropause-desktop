/**
 * Connector SDK (NCEA 10.4, Phase 2). The contract a connector implements:
 * metadata + version, an auth config, capabilities/dependencies/permissions/
 * policies, actions (with Zod-validated inputs), triggers, an optional rate
 * limit, and a health probe. Actions receive a `ConnectorExecutionContext` that
 * can reveal the connector's secrets at use time. Pagination / streaming /
 * file transfer / long-running jobs are action-shaped (an action returns a page,
 * stream handle, or job handle) — the SDK does not special-case them.
 */
import type { ZodType } from 'zod';
import type { AuthConfig } from './auth';

export interface ConnectorExecutionContext {
  traceId: string;
  actor: string;
  org?: string;
  workspace?: string;
  /** reveal one of this connector's secrets at use time (audited by the vault). */
  secret(key: string): Promise<string | undefined>;
  log(message: string, fields?: Record<string, unknown>): void;
}

export interface ActionDef<I = unknown, O = unknown> {
  name: string;
  description?: string;
  permissions: string[];
  schema?: ZodType<I>;
  execute(input: I, ctx: ConnectorExecutionContext): Promise<O>;
}

export type TriggerKind =
  | 'webhook'
  | 'polling'
  | 'schedule'
  | 'event'
  | 'manual'
  | 'ai'
  | 'approval'
  | 'dependency';

export interface TriggerDef {
  name: string;
  kind: TriggerKind;
  /** for polling/schedule triggers. */
  intervalMs?: number;
}

export interface ConnectorHealth {
  status: 'ok' | 'degraded' | 'down';
  detail?: string;
}

export interface ConnectorPolicy {
  name: string;
  allow: boolean;
  detail?: string;
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  version: string;
  category: string;
  auth: AuthConfig;
  capabilities: string[];
  permissions: string[];
  dependencies?: string[];
  policies?: ConnectorPolicy[];
  actions: ActionDef[];
  triggers?: TriggerDef[];
  rateLimit?: { capacity: number; refillPerSec: number };
  health?: () => ConnectorHealth;
}

/** Validate + return a connector definition (unique action names, non-empty id). */
export function defineConnector(def: ConnectorDefinition): ConnectorDefinition {
  if (!def.id) throw new Error('connector id is required');
  if (!def.version) throw new Error(`connector '${def.id}' requires a version`);
  const names = new Set<string>();
  for (const action of def.actions) {
    if (names.has(action.name)) throw new Error(`connector '${def.id}' has duplicate action '${action.name}'`);
    names.add(action.name);
  }
  return def;
}

export function connectorAction(def: ConnectorDefinition, name: string): ActionDef | undefined {
  return def.actions.find((a) => a.name === name);
}
