/**
 * EnterpriseModule — a single ERP module (Finance, CRM, …) as the framework
 * sees it: its declarative descriptor plus the record store that backs it, and
 * a couple of optional hooks. `defineEnterpriseModule` is the one function a
 * module author calls; it validates the descriptor and returns a ready module.
 *
 * Everything cross-cutting a module "inherits" — permissions, audit, timeline
 * events, broadcasts, generic CRUD IPC, and the renderer UI — is provided by the
 * registry + the shared descriptor, NOT re-implemented per module. A module is
 * therefore just: a descriptor + a store (+ optional validate/format hooks).
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleActionResult,
  EnterpriseModuleDescriptor,
  EnterpriseModuleLifecycleAction,
  EnterprisePermission,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
  PlatformEventInput,
} from '@neuropause/shared';
import { validateEnterpriseRecordInput, validateModuleDescriptor } from '@neuropause/shared';
import type { EnterpriseRecordStore } from './enterpriseRecordStore';

/**
 * The capabilities the framework injects into every module's lifecycle. All are
 * pre-existing platform services — the module never wires them itself.
 */
export interface EnterpriseModuleContext {
  /** RBAC gate — throws if the current actor lacks the permission. */
  authorize: (permission: EnterprisePermission) => void;
  /** Append to the enterprise audit trail. */
  audit: (entry: { action: string; target: string; summary: string }) => void;
  /** Publish a platform event → timeline + Executive Center (no-op if absent). */
  publish?: (input: PlatformEventInput) => void;
  /** Broadcast a change to the renderer. */
  broadcast: (channel: string, payload: unknown) => void;
  /** Raise a native notification (modules opt in). */
  notify?: (title: string, body: string) => void;
  /** The current actor's identity (email/id/name), for audit + record authorship. */
  actor: () => string | null;
  /** Injected clock (tests pass a fixed value). */
  now: () => string;
}

/**
 * The capabilities the framework injects into a module's `runAction` hook — the
 * seam a custom record action (e.g. Lead → Customer conversion) uses to read and
 * write OTHER registered modules and emit their lifecycle events, without wiring
 * any of those services itself. The framework already authorized the acting
 * module's write permission before calling the hook.
 */
export interface EnterpriseModuleActionContext {
  /** The current actor's identity (email/id), for authorship + audit. */
  actor: () => string | null;
  /** Injected clock (tests pass a fixed value). */
  now: () => string;
  /** RBAC gate — throws if the actor lacks the permission (assert cross-module writes). */
  authorize: (permission: EnterprisePermission) => void;
  /** Resolve another registered module (Contacts, Customers, …) by id, or null. */
  moduleFor: (moduleId: string) => EnterpriseModule | null;
  /**
   * Run the full lifecycle fan-out (audit + platform timeline + renderer
   * broadcast + the target module's own `onChange`) for a record an action
   * created or changed in another module — so cross-module writes are audited
   * and surfaced identically to direct CRUD.
   */
  emit: (
    module: EnterpriseModule,
    action: EnterpriseModuleLifecycleAction,
    record: EnterpriseEntity,
  ) => void;
}

/** Optional per-module hooks. Defaults cover the common case. */
export interface EnterpriseModuleHooks {
  /**
   * Validate + coerce a record input. Defaults to descriptor-driven validation
   * (`validateEnterpriseRecordInput`); override to add cross-field rules.
   */
  validate?: (input: EnterpriseRecordInput) => EnterpriseRecordValidation;
  /** Observe a record change after it is persisted (e.g. derive a projection). */
  onChange?: (event: {
    action: EnterpriseModuleLifecycleAction;
    record: EnterpriseEntity;
  }) => void;
  /**
   * Produce an AI-assisted summary + risk for a record, through the existing AI
   * pipeline. Optional — modules that provide it light up the AI Summary surface
   * automatically (`EnterpriseModuleSummary.aiSummary`), with no renderer changes.
   */
  summarize?: (record: EnterpriseEntity) => Promise<EnterpriseRecordSummary>;
  /**
   * Run a custom, module-declared record action (see `descriptor.actions`) — the
   * generic `enterprise:module.action` handler dispatches here after authorizing
   * the module's write permission and loading the record. Modules that provide
   * it surface their `descriptor.actions` as buttons in the record detail, with
   * no renderer changes.
   */
  runAction?: (
    action: string,
    record: EnterpriseEntity,
    actionCtx: EnterpriseModuleActionContext,
  ) => Promise<EnterpriseModuleActionResult>;
}

export interface EnterpriseModule {
  descriptor: EnterpriseModuleDescriptor;
  store: EnterpriseRecordStore;
  hooks: Required<Pick<EnterpriseModuleHooks, 'validate'>> & EnterpriseModuleHooks;
}

export interface EnterpriseModuleConfig {
  descriptor: EnterpriseModuleDescriptor;
  store: EnterpriseRecordStore;
  hooks?: EnterpriseModuleHooks;
}

/**
 * Define a module. Validates the descriptor's internal consistency up-front —
 * an inconsistent module is a programming error and fails loudly at wiring time,
 * never silently at runtime.
 */
export function defineEnterpriseModule(config: EnterpriseModuleConfig): EnterpriseModule {
  const problems = validateModuleDescriptor(config.descriptor);
  if (problems.length > 0) {
    throw new Error(`Invalid enterprise module "${config.descriptor.id}": ${problems.join(' ')}`);
  }
  const validate =
    config.hooks?.validate ?? ((input) => validateEnterpriseRecordInput(config.descriptor, input));
  return {
    descriptor: config.descriptor,
    store: config.store,
    hooks: { ...config.hooks, validate },
  };
}
