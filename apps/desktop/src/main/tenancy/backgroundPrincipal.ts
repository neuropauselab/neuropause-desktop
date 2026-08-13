/**
 * Who a background job is acting as.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Every scoped store in this system resolves its tenant by asking "who is the
 * signed-in user acting as right now?" — `activeTenantScope()`, which reads the
 * active workspace. That question is meaningful during an IPC call and
 * meaningless inside a timer: a background job has no UI, may run while the
 * user is signed out, and may still be running after they have switched to a
 * different organization.
 *
 * Program 13B made the consequence visible rather than silent. Events are
 * stamped with the resolved tenant at publish time, so a job with no principal
 * publishes an UNOWNED event — durable, and invisible to everyone. That is
 * fail-closed and correct, and it is also a functional gap: the runtime
 * supervisor's critical alerts stopped appearing in anyone's timeline.
 *
 * WHY ASYNC-LOCAL STORAGE, AND WHY THAT IS NOT "GLOBAL MUTABLE STATE"
 *
 * The obvious alternative is threading a principal parameter through every
 * publish and every store call. That is ~100 call sites, and one missed site
 * fails open silently — the exact shape of bug Program 11 was written to
 * remove.
 *
 * `AsyncLocalStorage` carries the principal along the ASYNC EXECUTION of one
 * job. It is not a mutable global: two jobs running concurrently each see their
 * own principal, and neither can observe or overwrite the other's. That
 * property is what makes it safe here and is exactly what a `let
 * currentTenant` could never provide — which is the pattern this file exists to
 * replace, not to reintroduce.
 *
 * HOW IT COMPOSES WITH WHAT ALREADY EXISTS
 *
 * The resolvers (`activeTenantScope`, `activeMemoryViewer`) PREFER a background
 * principal when one is in scope and fall back to the session otherwise. So
 * every store scoped in Programs 11-13B becomes correct inside a job with no
 * change to the store: the boundary is already drawn, this only tells it whose
 * side it is on. There is no second authorization mechanism.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { EnterprisePermission, TenantScope } from '@neuropause/shared';

/**
 * What kind of authority a job runs with.
 *
 * `system` is deliberately NOT "a tenant that can see everything". It means the
 * work belongs to the product rather than to any customer — a health check, an
 * update poll — and it carries no tenant at all. A system job that touched a
 * tenant-scoped store would read nothing, which is the correct answer.
 */
export type BackgroundPrincipalType = 'system' | 'tenant' | 'workspace';

export interface BackgroundPrincipal {
  /** Stable identifier for the job class, e.g. `job:connector-sync`. */
  principalId: string;
  principalType: BackgroundPrincipalType;
  /** Null for `system`. Required for `tenant` and `workspace`. */
  tenantId: string | null;
  /** Set for `workspace` only. */
  workspaceId: string | null;
  /** The authority this job carries. Empty for `system`. */
  permissions: readonly EnterprisePermission[];
  /** This job class. Stable across runs — for correlating a job's history. */
  jobId: string;
  /** THIS RUN. Unique per execution, so one run's events can be joined. */
  requestId: string;
}

const storage = new AsyncLocalStorage<BackgroundPrincipal>();

/** The principal of the job currently executing, or null on the UI path. */
export function currentPrincipal(): BackgroundPrincipal | null {
  return storage.getStore() ?? null;
}

/**
 * The tenant scope of the running job, or null.
 *
 * Returns null for a SYSTEM principal — a system job has no tenant, and saying
 * so is different from saying "no job is running". Callers that need to tell
 * those apart use `currentPrincipal()`.
 */
export function principalScope(): TenantScope | null {
  const p = storage.getStore();
  if (!p || p.tenantId === null) return null;
  /**
   * A tenant-level principal reports its tenant with an EMPTY workspace.
   *
   * `recordInScope` treats a record with no workspace as tenant-wide, and a
   * record WITH a workspace as visible only from that workspace. So a
   * tenant-level job reading with `workspaceId: ''` sees tenant-level records
   * and no workspace-scoped ones — which is the honest reading of "this job
   * acts for the organization, not from inside any one workspace".
   */
  return { tenantId: p.tenantId, workspaceId: p.workspaceId ?? '' };
}

/**
 * Run `fn` as `principal`. Everything it awaits inherits the principal.
 *
 * The principal is captured by the CALLER, at the moment the job is scheduled
 * or enqueued — not resolved inside `fn`. That ordering is the point: a job
 * enqueued while tenant A was active must still run as A even if the user has
 * switched to B by the time it drains.
 */
export function runAsPrincipal<T>(principal: BackgroundPrincipal, fn: () => T): T {
  return storage.run(principal, fn);
}

/**
 * Build a principal for a tenant-scoped job, or null if no tenant resolves.
 *
 * NULL IS THE FAIL-CLOSED ANSWER and callers must treat it as "do not run".
 * There is deliberately no variant of this function that substitutes a default
 * organization, the first organization, or the currently active one — those are
 * the four fallbacks the program forbids, and a function that cannot express
 * them cannot be asked for them.
 */
export function tenantPrincipal(input: {
  jobId: string;
  scope: TenantScope | null;
  permissions?: readonly EnterprisePermission[];
  /** Set when the job's authority is one workspace rather than the tenant. */
  workspaceScoped?: boolean;
}): BackgroundPrincipal | null {
  if (input.scope === null || !input.scope.tenantId) return null;
  return {
    principalId: `job:${input.jobId}`,
    principalType: input.workspaceScoped ? 'workspace' : 'tenant',
    tenantId: input.scope.tenantId,
    workspaceId: input.workspaceScoped ? input.scope.workspaceId : null,
    permissions: input.permissions ?? [],
    jobId: input.jobId,
    requestId: `run_${randomUUID()}`,
  };
}

/** A principal for genuinely global maintenance. Carries no tenant. */
export function systemPrincipal(jobId: string): BackgroundPrincipal {
  return {
    principalId: `job:${jobId}`,
    principalType: 'system',
    tenantId: null,
    workspaceId: null,
    permissions: [],
    jobId,
    requestId: `run_${randomUUID()}`,
  };
}

/**
 * The scope to act under: the running job's, or the session's.
 *
 * THE ONE PLACE THE PRECEDENCE IS DECIDED. `activeTenantScope`, the event bus
 * and every test resolve through this, so there is a single opinion about
 * which authority wins rather than three that can drift.
 *
 * A PRESENT PRINCIPAL ALWAYS WINS, INCLUDING WHEN ITS SCOPE IS NULL. That last
 * part is the subtle half: a SYSTEM job has no tenant, and falling through to
 * the session would hand it whichever organization the user happened to have
 * open — turning a global maintenance job into an unwitting actor inside
 * someone's tenant. "No tenant" is an answer here, not a missing value.
 */
export function resolveTenantScope(session: () => TenantScope | null): TenantScope | null {
  return storage.getStore() ? principalScope() : session();
}

/**
 * Run `fn` with NO principal, even when called from inside a job.
 *
 * WHY THIS IS NOT A BACK DOOR
 *
 * It grants nothing. Leaving the principal means falling back to the SESSION,
 * so `fn` sees exactly what the signed-in user would see — never more. A job
 * cannot use this to read another tenant; it can only stop pretending to be one.
 *
 * WHAT IT IS ACTUALLY FOR
 *
 * Telling the RENDERER something. A background pass legitimately runs as tenant
 * A while the window in front of the user is showing tenant B, and any value
 * computed for the UI during that pass — an unread badge, a live count — must
 * be the count B's viewer is entitled to, not A's. Without this the fan-out
 * would broadcast tenant A's unread total into tenant B's window: a small
 * number, and still one tenant's activity visible to another.
 *
 * `exit` is the AsyncLocalStorage primitive for exactly this and is scoped to
 * the callback, so the principal is restored the moment `fn` returns.
 */
export function runOutsidePrincipal<T>(fn: () => T): T {
  return storage.exit(fn);
}
