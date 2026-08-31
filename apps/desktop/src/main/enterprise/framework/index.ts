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
import type { EnterpriseModuleActionContext, EnterpriseModuleContext } from './enterpriseModule';
import {
  EnterpriseModuleRegistry,
  buildModuleHandlers,
  createLifecycleEmitter,
  notifyImportedRecords,
  type ImportedRecordsNotification,
  type ImportedRecordsResult,
} from './moduleRegistry';

export * from './enterpriseRecordStore';
export * from './enterpriseModule';
export * from './moduleRegistry';
export * from './transactionGraph';

/** Canonical on-disk location for a module's record store (userData). */
export function enterpriseModuleStorePath(userDataDir: string, moduleId: string): string {
  return join(userDataDir, `enterprise-module-${moduleId}.json`);
}

export interface EnterpriseModulesSubsystem {
  registry: EnterpriseModuleRegistry;
  handlers: SecureHandlerDef[];
  /**
   * Replay records created OUTSIDE the CRUD handlers (a Data Plane import)
   * through the same lifecycle fan-out, so they are audited, broadcast to open
   * views, and seen by every module's `onChange` reconciler.
   */
  notifyImported: (event: ImportedRecordsNotification) => Promise<ImportedRecordsResult>;
  /**
   * The shared action context, for services that live OUTSIDE the module CRUD
   * handlers but still need to reach registered modules — the Medical Device
   * lot service posting to the inventory ledger, for one.
   *
   * Exposed rather than reconstructed by each caller: a second, independently
   * built context would carry a second identity and a second RBAC gate, and the
   * two would drift. There is one lifecycle fan-out in this system and this is
   * how a non-CRUD caller reaches it.
   */
  actionContext: EnterpriseModuleActionContext;
}

/**
 * Create the module registry + its generic IPC handlers. Handlers resolve the
 * target module from each call's payload, so modules registered after this call
 * are served without any additional wiring.
 */
export function initEnterpriseModules(ctx: EnterpriseModuleContext): EnterpriseModulesSubsystem {
  const registry = new EnterpriseModuleRegistry();
  const handlers = buildModuleHandlers(registry, ctx);
  const { actionCtx } = createLifecycleEmitter(registry, ctx);
  return {
    registry,
    handlers,
    notifyImported: (event) => notifyImportedRecords(registry, ctx, event),
    actionContext: actionCtx,
  };
}
