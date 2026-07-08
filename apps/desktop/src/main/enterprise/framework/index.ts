/**
 * Enterprise Module Framework — public entry point.
 *
 * The reusable foundation every ERP module (Finance, CRM, Sales, Inventory, HR,
 * Projects, …) is built on. A module supplies a descriptor + a record store;
 * the framework gives it, for free: RBAC, audit, timeline events, renderer
 * broadcasts, generic CRUD IPC, offline-first persistence, and a cloud-sync-ready
 * record shape. No module re-implements any of that.
 *
 * `initEnterpriseModules(ctx)` builds the generic handler set and an empty
 * registry; callers register modules into it (none in this foundation release).
 */
import { join } from 'node:path';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import type { EnterpriseModuleContext } from './enterpriseModule';
import { EnterpriseModuleRegistry, buildModuleHandlers } from './moduleRegistry';

export * from './enterpriseRecordStore';
export * from './enterpriseModule';
export * from './moduleRegistry';

/** Canonical on-disk location for a module's record store (userData). */
export function enterpriseModuleStorePath(userDataDir: string, moduleId: string): string {
  return join(userDataDir, `enterprise-module-${moduleId}.json`);
}

export interface EnterpriseModulesSubsystem {
  registry: EnterpriseModuleRegistry;
  handlers: SecureHandlerDef[];
}

/**
 * Create the module registry + its generic IPC handlers. Handlers resolve the
 * target module from each call's payload, so modules registered after this call
 * are served without any additional wiring.
 */
export function initEnterpriseModules(ctx: EnterpriseModuleContext): EnterpriseModulesSubsystem {
  const registry = new EnterpriseModuleRegistry();
  const handlers = buildModuleHandlers(registry, ctx);
  return { registry, handlers };
}
