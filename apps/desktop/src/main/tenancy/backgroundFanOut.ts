/**
 * WHICH tenants a background job runs for.
 *
 * THE HALF PROGRAM 13C PART 1 DID NOT BUILD
 *
 * Part 1 gave background work a principal, so a job that HAS one is correct.
 * Nothing decided which principals a job should have. Every timer in this
 * application is a single per-install timer that resolves its tenant from
 * `activeTenantScope()` — the signed-in user's current workspace. On a
 * single-tenant install that reads as correct. On a two-tenant install it is
 * wrong twice over, and the two failures point in opposite directions:
 *
 *   1. THE WRONG TENANT RUNS. The 07:00 brief is built from whichever
 *      organization happened to be open in the UI at 07:00. Tenant A's
 *      scheduled brief can be assembled out of tenant B's records.
 *
 *   2. THE OTHER TENANTS DO NOT RUN AT ALL. There is one delivery-engine tick,
 *      so exactly one organization is ever served. B's brief never fires, B's
 *      meeting reminders never scan, B's accounts never sync.
 *
 * Failure (2) is why this cannot be fixed by wrapping the existing tick in a
 * principal. There is no single correct principal for a job that is supposed to
 * happen for everyone. The job has to run N times, once per tenant, each run
 * under its own principal — which is precisely the shape Part 2a gave the
 * webhook producer when it stopped fanning one event out to every endpoint and
 * started selecting endpoints by the event's own tenant.
 *
 * WHY THE ANSWER IS A LIST AND NOT A CONTEXT
 *
 * `activeTenantScope()` answers "who is this request for?" — a question an IPC
 * call has and a timer does not. A timer's question is "who is this work owed
 * to?", and the honest answer is a set. Returning a list makes the fan-out
 * visible at every call site: a caller that only handles `[0]` is reviewable as
 * wrong, where a caller that reads an ambient scope looks fine.
 *
 * FAIL-CLOSED IS THE EMPTY LIST
 *
 * No operable organization means no runs. Not the default organization, not the
 * first one, not the one the UI has open. A job that does nothing is a
 * functional gap someone reports; a job that runs as the wrong tenant is a
 * disclosure nobody sees. This module cannot express the second — there is no
 * parameter that widens it and no fallback inside it.
 */
import type { EnterprisePermission, Organization, TenantScope, Workspace } from '@neuropause/shared';
import { organizationIsOperable } from '@neuropause/shared';
import type { BackgroundPrincipal } from './backgroundPrincipal';
import { runAsPrincipal, tenantPrincipal } from './backgroundPrincipal';

/** One tenant's slice of a fanned-out job. */
export interface TenantRun {
  principal: BackgroundPrincipal;
  scope: TenantScope;
  /** The organization this run acts for. Read-only; for logging and tests. */
  organization: Organization;
}

/**
 * The stores the fan-out reads.
 *
 * Injected rather than imported so this file unit-tests in node with no
 * Electron and no boot order, matching every other pure module here. It reads
 * ONLY server-side state: there is no seam for a caller-supplied tenant.
 */
export interface TenantFanOutDeps {
  /** Every organization on this install, operable or not. */
  organizations: () => Organization[];
  /** Every workspace, across organizations. */
  workspaces: () => Workspace[];
}

export interface FanOutOptions {
  /** Authority each run carries. Same for every tenant — it is the JOB's authority. */
  permissions?: readonly EnterprisePermission[];
  /**
   * Run once per WORKSPACE instead of once per organization.
   *
   * Default false, and the default is the safer one: a tenant-level principal
   * reports an empty workspace, which `recordInScope` reads as tenant-wide and
   * therefore excludes workspace-scoped records. A job that opts into workspace
   * fan-out is saying its work is per-workspace, and gets N runs for a tenant
   * with N workspaces.
   */
  perWorkspace?: boolean;
}

/**
 * A SUSPENDED TENANT'S BACKGROUND WORK STOPS.
 *
 * `organizationIsOperable` is the same predicate `tenantContext.resolveFull()`
 * applies to an interactive request, and applying it here is what makes
 * suspension mean something: a boundary that stops the UI but leaves the timers
 * running still syncs the account, still sends the webhook, still writes the
 * records. Reusing the shared predicate rather than re-deriving it is the point
 * — two implementations of "is this tenant allowed to operate" is how one of
 * them drifts.
 */
function operable(orgs: Organization[]): Organization[] {
  return orgs
    .filter((o) => organizationIsOperable(o))
    /**
     * Sorted by id, always.
     *
     * The store hands back Map insertion order, which is file order, which
     * changes when an organization is created. Ordering the fan-out makes a
     * two-tenant test deterministic and makes "A ran before B" a fact about the
     * ids rather than about which one was seeded first.
     */
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every tenant run a job should perform, in a stable order.
 *
 * Empty when nothing is operable, and empty is a valid answer meaning "this job
 * has no work". Callers must not treat it as "fall back to something".
 */
export function tenantRuns(
  jobId: string,
  deps: TenantFanOutDeps,
  options: FanOutOptions = {},
): TenantRun[] {
  const orgs = operable(deps.organizations());
  if (orgs.length === 0) return [];

  const runs: TenantRun[] = [];

  if (!options.perWorkspace) {
    for (const organization of orgs) {
      const principal = tenantPrincipal({
        jobId,
        scope: { tenantId: organization.id, workspaceId: '' },
        ...(options.permissions ? { permissions: options.permissions } : {}),
      });
      /**
       * `tenantPrincipal` returns null for a blank tenant id, and a blank id is
       * a corrupt organization row rather than an impossible one. Skipping it
       * drops that organization from the fan-out instead of throwing and
       * stopping every LATER tenant's run — one bad row must not silently
       * cancel everybody else's scheduled work.
       */
      if (principal === null) continue;
      runs.push({
        principal,
        scope: { tenantId: organization.id, workspaceId: '' },
        organization,
      });
    }
    return runs;
  }

  const byOrg = new Map<string, Workspace[]>();
  for (const w of deps.workspaces()) {
    const list = byOrg.get(w.organizationId);
    if (list) list.push(w);
    else byOrg.set(w.organizationId, [w]);
  }

  for (const organization of orgs) {
    const workspaces = (byOrg.get(organization.id) ?? [])
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const workspace of workspaces) {
      const scope: TenantScope = { tenantId: organization.id, workspaceId: workspace.id };
      const principal = tenantPrincipal({
        jobId,
        scope,
        workspaceScoped: true,
        ...(options.permissions ? { permissions: options.permissions } : {}),
      });
      if (principal === null) continue;
      runs.push({ principal, scope, organization });
    }
  }
  return runs;
}

/** What one fanned-out execution did. Failures are reported, never thrown. */
export interface FanOutOutcome {
  tenantId: string;
  workspaceId: string;
  ok: boolean;
  error: string | null;
}

/**
 * Run `fn` once per tenant, each under that tenant's own principal.
 *
 * SEQUENTIAL, AND THAT IS A CORRECTNESS CHOICE, NOT A PERFORMANCE ONE.
 *
 * `AsyncLocalStorage` would keep concurrent runs correctly separated — that is
 * its whole property — so isolation does not require sequencing. What requires
 * it is everything DOWNSTREAM that is not async-local: the TTL model caches
 * listed as BLOCKED in the migration inventory are keyless `let cache`
 * variables, and two tenants' jobs interleaving through them is exactly the
 * cross-tenant cache the program forbids. Running one tenant at a time means a
 * cache built during A's run is consumed during A's run.
 *
 * ONE TENANT'S FAILURE DOES NOT CANCEL THE NEXT TENANT'S RUN. A throw inside
 * `fn` is captured into that tenant's outcome and the loop continues — because
 * the alternative is that tenant A's expired token silently stops tenant B's
 * backups, and B has no way to see that it happened.
 */
export async function forEachTenant(
  jobId: string,
  deps: TenantFanOutDeps,
  fn: (run: TenantRun) => void | Promise<void>,
  options: FanOutOptions = {},
): Promise<FanOutOutcome[]> {
  const runs = tenantRuns(jobId, deps, options);
  const outcomes: FanOutOutcome[] = [];
  for (const run of runs) {
    try {
      await runAsPrincipal(run.principal, () => Promise.resolve(fn(run)));
      outcomes.push({
        tenantId: run.scope.tenantId,
        workspaceId: run.scope.workspaceId,
        ok: true,
        error: null,
      });
    } catch (err) {
      outcomes.push({
        tenantId: run.scope.tenantId,
        workspaceId: run.scope.workspaceId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}

/**
 * A principal for work that belongs to ONE ALREADY-KNOWN tenant.
 *
 * For the event-driven half, where the tenant is not enumerated but carried:
 * a bus event stamped by Program 13B, a webhook delivery row, a queued job. The
 * scope comes from the ARTEFACT, never from the session — which is the same
 * rule Part 2a applied to webhook deliveries, expressed once so the
 * notification path cannot invent a second one.
 *
 * Returns null when the artefact has no owner. A pre-13B event, or one
 * published before the app knew its tenant, is unowned; delivering it to
 * somebody would mean choosing a tenant for it, and there is no honest choice.
 */
export function principalForOwnedWork(input: {
  jobId: string;
  tenantId: string | null | undefined;
  workspaceId: string | null | undefined;
  permissions?: readonly EnterprisePermission[];
}): BackgroundPrincipal | null {
  const tenantId = input.tenantId ?? null;
  if (tenantId === null || tenantId === '') return null;
  const workspaceId = input.workspaceId ?? '';
  return tenantPrincipal({
    jobId: input.jobId,
    scope: { tenantId, workspaceId },
    workspaceScoped: workspaceId !== '',
    ...(input.permissions ? { permissions: input.permissions } : {}),
  });
}
