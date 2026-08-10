/**
 * The Workday connector FAMILY (P5 — Increment 14) — HCM, Recruiting, Payroll, Benefits, Learning &
 * Absence via the Workday REST APIs.
 *
 * ONE connector (`workday`) — one OAuth 2.0 API Client, one token, one vault record, one card, one health
 * engine, one inspector — with each Workday business object mounted as an `AdapterResource` on the SAME
 * authenticated session, read through the uniform Workday REST collection endpoints. This mirrors, exactly,
 * how `microsoft-entra` hosts M365 and `salesforce`/`servicenow`/`sap`/`oracle`/`dynamics365` host their
 * objects. Every resource is wrapped in the shared `graceful()` guard, so an object whose Workday module
 * isn't provisioned (404), the Integration System User's security groups can't read (403), or that a given
 * tenant's REST version doesn't expose (400) degrades to a tagged empty page instead of failing the family.
 *
 * The Workday wrinkles, and how each is handled by EXTENDING existing seams:
 *   • **Per-tenant host AND tenant name.** Every OAuth and REST endpoint embeds BOTH the customer's host
 *     (`{host}.workday.com`) AND the tenant short-name (`acme`) — `.../ccx/api/{service}/{version}/{tenant}/…`.
 *     Both come from env (`NEUROPAUSE_WORKDAY_HOST` + `NEUROPAUSE_WORKDAY_TENANT`) — in the manifest (for the
 *     authorize/token URLs, the SAP host+client precedent) and here (for the data calls, the sapBase() env-
 *     base precedent). Read at call time. No per-org resolution call.
 *   • **`expires_in` + a (optionally non-expiring) refresh token**, so the EXISTING proactive-refresh path
 *     covers it with no synthesized TTL (like HubSpot/ServiceNow/SAP/Oracle/Dynamics). The token endpoint
 *     takes HTTP Basic client auth — handled entirely in the manifest (`tokenAuthStyle: 'basic'`).
 *   • **Access is ISU security-group governed, not per-object OAuth scope** — an OAuth functional-area scope
 *     is necessary but the Integration System User's security groups + domain security policies are the real
 *     gate. So — like Salesforce/ServiceNow/SAP/Oracle/Dynamics, unlike the scope-gated families — there is
 *     NO scope catalog and NO `serviceCapabilities` branch; which modules (HR / Payroll / Benefits /
 *     Recruiting / Learning / Time Tracking / Absence / Compensation) a tenant exposes is discovered at
 *     RUNTIME from the per-module degrade the Supervisor overlays.
 *   • **Uniform REST shape** — every collection endpoint returns `{ total, data: [ … ] }` and pages by
 *     `offset`/`limit` (max 100). Reference/instance fields render uniformly as `{ id: <WID>, descriptor:
 *     <label> }`. A WID identifies a unique INSTANCE, but the SAME instance surfaces in MORE THAN ONE
 *     endpoint (a supervisory organization IS an organization; a department is an organization), and several
 *     endpoints share a UDM `kind` — so the raw WID alone would alias across resources (unified id =
 *     `connector:account:kind:sourceId`, no resource segment). Every sourceId is therefore PREFIXED with its
 *     object type (the SAP/Oracle collision guard), so the same WID in two resources yields two distinct,
 *     self-describing ids. No `$select`/field list is sent (the endpoint returns the whole object), so a
 *     per-tenant field-name variance never fails a query — the Oracle no-field-projection robustness.
 *   • **No universal "updated-since" delta.** Neither the REST list endpoints nor WQL expose a uniform
 *     modified-time filter (that is a SOAP `Get_Workers` transaction-log capability). So every object is a
 *     full `offset`/`limit` snapshot walk that CONTINUES across runs (bounded by the orchestrator's page cap)
 *     and RESETS on drain — the leapfrog-free full-list pattern proven at `sap.ts` / `oracle.ts`; the store
 *     dedups an unchanged row (no write unless changed). Per-object modified-time incremental via the SOAP
 *     transaction log / a RaaS updated-since prompt is a documented future enhancement.
 *
 * Object → UDM:
 *   workers / candidates                                        → contact
 *   organizations / departments / supervisory_organizations     → organization
 *   positions / jobs / benefits / payroll / learning            → document
 *   recruiting (job requisitions)                               → task
 *   time_off                                                    → event
 */
import type { UnifiedEntity, UnifiedEntityKind } from '@neuropause/shared';
import type { AdapterResource, ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { HttpError } from '../http';
import { graceful } from './delta';
import { parseJsonCursor, toJsonCursor, truncate } from './util';

/** The env vars supplying the customer's host + tenant (also read by the manifest for the OAuth URLs). */
const WORKDAY_HOST_ENV = 'NEUROPAUSE_WORKDAY_HOST';
const WORKDAY_TENANT_ENV = 'NEUROPAUSE_WORKDAY_TENANT';
/** Workday's native REST page maximum is 100 (`limit`); the offset continuation walks the rest across runs. */
const PAGE = 100;
/** Stable baseline for the WHO stamps — Workday REST exposes no uniform modified time, so both stamps are
 *  this fixed baseline (never the run clock, which would re-churn every row every sync). */
const WORKDAY_STABLE_TS = '1970-01-01T00:00:00.000Z';

/** The tenant API host, from configuration (never a per-org resolution call). Read at call time so a test /
 *  late-set env is honored, exactly like sapBase() / the github.ts env-base. */
function workdayBase(): string {
  const host = (process.env[WORKDAY_HOST_ENV] ?? '').trim();
  return `https://${host || 'HOST.workday.com'}`;
}
/** The tenant short-name path segment, from configuration. */
function workdayTenant(): string {
  return (process.env[WORKDAY_TENANT_ENV] ?? '').trim() || 'TENANT';
}

/* ── Workday REST helpers (reference fields render as { id: WID, descriptor: label }) ─────────────── */

type WorkdayRecord = Record<string, unknown>;

/** A top-level scalar field as a trimmed string, or null (skips nested reference objects). */
function s(rec: WorkdayRecord, k: string): string | null {
  const v = rec[k];
  if (v == null || typeof v === 'object') return null;
  const str = String(v).trim();
  return str || null;
}
/** The `descriptor` (human label) of a nested `{ id, descriptor }` reference field, or null. */
function ref(rec: WorkdayRecord, k: string): string | null {
  const v = rec[k];
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const d = (v as Record<string, unknown>).descriptor;
    if (d != null) {
      const str = String(d).trim();
      if (str) return str;
    }
  }
  return null;
}
/** The row's own stable identifier (Workday ID / WID) — globally unique across Workday objects. */
function wid(rec: WorkdayRecord): string | null {
  return s(rec, 'id');
}
/** The row's own human-readable descriptor. */
function desc(rec: WorkdayRecord): string | null {
  return s(rec, 'descriptor');
}

/* ── Entity spec ───────────────────────────────────────────────────────────────── */

/** One Workday object mounted as a service resource. id === resource id === catalog id === module-stat id. */
interface WorkdaySpec {
  id: string;
  label: string;
  /** REST service segment (`/ccx/api/{service}/{version}/{tenant}/{resource}`). */
  service: string;
  /** REST version segment. */
  version: string;
  /** REST collection resource segment. */
  resource: string;
  kind: UnifiedEntityKind;
  /** SourceId prefix + collision guard — the same WID can surface in >1 endpoint sharing a `kind`. */
  prefix: string;
  map: (ctx: SyncContext, rec: WorkdayRecord) => UnifiedEntity;
}

/**
 * The shared UDM envelope. `sourceId` is the object-type-PREFIXED WID: a WID is unique per instance, but the
 * same instance appears in more than one endpoint and several endpoints share a `kind`, so the prefix keeps
 * unified ids collision-free AND self-describing (the SAP/Oracle guard). Timestamps are a STABLE baseline
 * (Workday REST exposes no uniform modified time — see the header), never the run clock, so a row isn't
 * re-churned every sync (content changes are still caught by the store's content-signature tie-break). No
 * `url`: a Workday deep link needs per-tenant instance routing (documented, like SAP/Oracle).
 */
function base(ctx: SyncContext, spec: WorkdaySpec, rec: WorkdayRecord) {
  return {
    connectorId: ctx.connectorId,
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    kind: spec.kind,
    sourceId: `${spec.prefix}${wid(rec) ?? ''}`,
    now: ctx.now,
    url: null,
    createdAt: WORKDAY_STABLE_TS,
    updatedAt: WORKDAY_STABLE_TS,
  } as const;
}

/* ── Mappers ─────────────────────────────────────────────────────────────────────── */

export function mapWorker(ctx: SyncContext, rec: WorkdayRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.workday_workers, rec),
    title: desc(rec) || `Worker ${wid(rec)}`,
    author: s(rec, 'primaryWorkEmail'),
    metadata: {
      workdayObject: 'worker',
      descriptor: desc(rec),
      employeeId: s(rec, 'employeeID') || s(rec, 'workerId'),
      businessTitle: s(rec, 'businessTitle'),
      primaryJob: ref(rec, 'primaryJob'),
      primaryWorkEmail: s(rec, 'primaryWorkEmail'),
    },
  });
}

export function mapOrganization(ctx: SyncContext, rec: WorkdayRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.workday_organizations, rec),
    title: desc(rec) || s(rec, 'name') || `Organization ${wid(rec)}`,
    metadata: {
      workdayObject: 'organization',
      descriptor: desc(rec),
      code: s(rec, 'code') || s(rec, 'referenceID'),
      type: ref(rec, 'organizationType'),
      manager: ref(rec, 'manager'),
    },
  });
}

export function mapPosition(ctx: SyncContext, rec: WorkdayRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.workday_positions, rec),
    title: desc(rec) || `Position ${wid(rec)}`,
    metadata: {
      workdayObject: 'position',
      descriptor: desc(rec),
      jobProfile: ref(rec, 'jobProfile'),
      supervisoryOrganization: ref(rec, 'supervisoryOrganization'),
      availability: s(rec, 'availabilityDate'),
    },
  });
}

export function mapJob(ctx: SyncContext, rec: WorkdayRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.workday_jobs, rec),
    title: desc(rec) || s(rec, 'jobProfileName') || `Job Profile ${wid(rec)}`,
    body: truncate(s(rec, 'summary') || s(rec, 'jobDescription'), 300),
    metadata: {
      workdayObject: 'jobProfile',
      descriptor: desc(rec),
      code: s(rec, 'jobCode') || s(rec, 'referenceID'),
      managementLevel: ref(rec, 'managementLevel'),
      jobFamily: ref(rec, 'jobFamily'),
    },
  });
}

export function mapDepartment(ctx: SyncContext, rec: WorkdayRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.workday_departments, rec),
    title: desc(rec) || s(rec, 'name') || `Department ${wid(rec)}`,
    metadata: {
      workdayObject: 'department',
      descriptor: desc(rec),
      code: s(rec, 'code') || s(rec, 'referenceID'),
      manager: ref(rec, 'manager'),
    },
  });
}

export function mapSupervisoryOrg(ctx: SyncContext, rec: WorkdayRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.workday_supervisory_organizations, rec),
    title: desc(rec) || `Supervisory Organization ${wid(rec)}`,
    metadata: {
      workdayObject: 'supervisoryOrganization',
      descriptor: desc(rec),
      code: s(rec, 'code') || s(rec, 'referenceID'),
      manager: ref(rec, 'manager'),
      superiorOrganization: ref(rec, 'superiorOrganization'),
    },
  });
}

export function mapRequisition(ctx: SyncContext, rec: WorkdayRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.workday_recruiting, rec),
    title: desc(rec) || s(rec, 'jobPostingTitle') || `Job Requisition ${wid(rec)}`,
    status: ref(rec, 'requisitionStatus') || s(rec, 'status'),
    metadata: {
      workdayObject: 'jobRequisition',
      descriptor: desc(rec),
      requisitionId: s(rec, 'jobRequisitionID') || s(rec, 'referenceID'),
      status: ref(rec, 'requisitionStatus'),
      hiringManager: ref(rec, 'hiringManager'),
      supervisoryOrganization: ref(rec, 'supervisoryOrganization'),
    },
  });
}

export function mapCandidate(ctx: SyncContext, rec: WorkdayRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.workday_candidates, rec),
    title: desc(rec) || s(rec, 'name') || `Candidate ${wid(rec)}`,
    status: ref(rec, 'stage') || ref(rec, 'status'),
    author: s(rec, 'email'),
    metadata: {
      workdayObject: 'candidate',
      descriptor: desc(rec),
      stage: ref(rec, 'stage'),
      email: s(rec, 'email'),
      jobRequisition: ref(rec, 'jobRequisition'),
    },
  });
}

export function mapBenefit(ctx: SyncContext, rec: WorkdayRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.workday_benefits, rec),
    title: desc(rec) || `Benefit Plan ${wid(rec)}`,
    metadata: {
      workdayObject: 'benefitPlan',
      descriptor: desc(rec),
      planType: ref(rec, 'benefitPlanType') || ref(rec, 'planType'),
      provider: ref(rec, 'provider'),
    },
  });
}

export function mapPayroll(ctx: SyncContext, rec: WorkdayRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.workday_payroll, rec),
    title: desc(rec) || `Payroll Result ${wid(rec)}`,
    metadata: {
      workdayObject: 'payrollResult',
      descriptor: desc(rec),
      worker: ref(rec, 'worker'),
      payPeriod: ref(rec, 'payPeriod'),
      grossAmount: s(rec, 'grossAmount'),
      netAmount: s(rec, 'netAmount'),
    },
  });
}

export function mapLearning(ctx: SyncContext, rec: WorkdayRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.workday_learning, rec),
    title: desc(rec) || s(rec, 'title') || `Learning ${wid(rec)}`,
    status: ref(rec, 'enrollmentStatus') || ref(rec, 'status'),
    metadata: {
      workdayObject: 'learning',
      descriptor: desc(rec),
      learner: ref(rec, 'learner') || ref(rec, 'worker'),
      status: ref(rec, 'enrollmentStatus'),
      course: ref(rec, 'course') || ref(rec, 'learningContent'),
    },
  });
}

export function mapTimeOff(ctx: SyncContext, rec: WorkdayRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.workday_time_off, rec),
    title: desc(rec) || `Time Off ${wid(rec)}`,
    status: ref(rec, 'status'),
    timestamp: s(rec, 'startDate'),
    endTimestamp: s(rec, 'endDate'),
    metadata: {
      workdayObject: 'timeOff',
      descriptor: desc(rec),
      worker: ref(rec, 'worker'),
      timeOffType: ref(rec, 'timeOffType') || ref(rec, 'type'),
      status: ref(rec, 'status'),
      startDate: s(rec, 'startDate'),
      endDate: s(rec, 'endDate'),
    },
  });
}

/* ── Object catalog ────────────────────────────────────────────────────────────── */

const SPECS: WorkdaySpec[] = [
  { id: 'workday_workers', label: 'Workers', service: 'staffing', version: 'v6', resource: 'workers', kind: 'contact', prefix: 'worker-', map: mapWorker },
  { id: 'workday_organizations', label: 'Organizations', service: 'common', version: 'v1', resource: 'organizations', kind: 'organization', prefix: 'organization-', map: mapOrganization },
  { id: 'workday_positions', label: 'Positions', service: 'staffing', version: 'v6', resource: 'positions', kind: 'document', prefix: 'position-', map: mapPosition },
  { id: 'workday_jobs', label: 'Jobs', service: 'staffing', version: 'v6', resource: 'jobProfiles', kind: 'document', prefix: 'job-', map: mapJob },
  { id: 'workday_departments', label: 'Departments', service: 'common', version: 'v1', resource: 'departments', kind: 'organization', prefix: 'department-', map: mapDepartment },
  { id: 'workday_supervisory_organizations', label: 'Supervisory Organizations', service: 'staffing', version: 'v6', resource: 'supervisoryOrganizations', kind: 'organization', prefix: 'supervisory_org-', map: mapSupervisoryOrg },
  { id: 'workday_recruiting', label: 'Recruiting', service: 'recruiting', version: 'v4', resource: 'jobRequisitions', kind: 'task', prefix: 'requisition-', map: mapRequisition },
  { id: 'workday_candidates', label: 'Candidates', service: 'recruiting', version: 'v4', resource: 'candidates', kind: 'contact', prefix: 'candidate-', map: mapCandidate },
  { id: 'workday_benefits', label: 'Benefits', service: 'benefits', version: 'v1', resource: 'plans', kind: 'document', prefix: 'benefit-', map: mapBenefit },
  { id: 'workday_payroll', label: 'Payroll', service: 'payroll', version: 'v1', resource: 'payrollResults', kind: 'document', prefix: 'payroll-', map: mapPayroll },
  { id: 'workday_learning', label: 'Learning', service: 'learning', version: 'v1', resource: 'enrollments', kind: 'document', prefix: 'learning-', map: mapLearning },
  { id: 'workday_time_off', label: 'Time Off', service: 'absenceManagement', version: 'v1', resource: 'timeOffs', kind: 'event', prefix: 'time_off-', map: mapTimeOff },
];

const SPEC_BY_ID: Record<string, WorkdaySpec> = Object.fromEntries(SPECS.map((sp) => [sp.id, sp]));

/* ── Uniform REST offset/limit pull ────────────────────────────────────────────── */

interface WorkdayResp {
  total?: number;
  data?: WorkdayRecord[];
}

interface WorkdayCursor {
  /** REST `offset`. A full-list snapshot walk: continues across runs (bounded by the orchestrator's page cap),
   *  and resets to 0 on drain so the next pass re-syncs the snapshot. */
  offset?: number;
}

/** Degrade a resource visibly (never a silent healthy zero) while keeping the family alive; preserves the cursor. */
function degradedPage(ctx: SyncContext, reason: string): SyncPage {
  return { entities: [], deletedSourceIds: [], cursor: ctx.cursor, hasMore: false, degraded: { kind: 'unprovisioned', reason } };
}

/**
 * Pull one page of `spec` via the Workday REST API. `offset`/`limit` over the `{ total, data }` envelope,
 * advancing the offset by the ACTUAL row count and terminating when `offset + rows < total` is false (or a
 * short/empty page when `total` is absent). The offset CONTINUES across runs (a full-list snapshot walk,
 * bounded by the orchestrator's page cap) and RESETS to 0 on drain — the leapfrog-free full-list pattern of
 * `sap.ts` / `oracle.ts`; the store dedups an unchanged row. A 404 (module/resource not provisioned) and 403
 * (ISU security group) are left to `graceful`; a 400 (a per-version REST-shape quirk) degrades VISIBLY.
 */
function makePull(spec: WorkdaySpec): (ctx: SyncContext) => Promise<SyncPage> {
  return async (ctx: SyncContext): Promise<SyncPage> => {
    const c = parseJsonCursor<WorkdayCursor>(ctx.cursor) ?? {};
    const offset = c.offset ?? 0;
    const url = `${workdayBase()}/ccx/api/${spec.service}/${spec.version}/${workdayTenant()}/${spec.resource}`;

    let resp;
    try {
      resp = await ctx.http.getJson<WorkdayResp>(url, { query: { limit: PAGE, offset } });
    } catch (err) {
      // A missing module/resource is 404 and an ISU security-group denial is 403 (both handled by graceful).
      // A 400 is a per-version REST-shape quirk — degrade the object VISIBLY (a distinct reason, not a silent
      // zero) so a systematic problem is observable, and keep the family alive. The cursor is preserved.
      if (err instanceof HttpError && err.status === 400) {
        return degradedPage(ctx, `Workday resource ${spec.service}/${spec.version}/${spec.resource} returned 400 — not available in this REST version on this tenant (verify the service/version/resource path)`);
      }
      throw err;
    }

    // Optional-chain `resp.data` — the HttpClient sets it to null on an empty 200 body; `?? []` then yields a
    // clean drain instead of a TypeError that would escape graceful and fail the whole account sync.
    const rows = resp.data?.data ?? [];
    const total = typeof resp.data?.total === 'number' ? resp.data.total : null;
    // Map only rows carrying a WID — a keyless row would coalesce to an empty sourceId and collide. Defensive.
    const entities = rows.filter((r) => wid(r) != null).map((r) => spec.map(ctx, r));

    // `total` is authoritative when present (stop when this page reaches it); else fall back to a full-page
    // heuristic. The `rows.length > 0` guard stops a pathological non-empty-`total`-with-no-rows loop.
    const more = (total != null ? offset + rows.length < total : rows.length === PAGE) && rows.length > 0;
    const cursor = more ? toJsonCursor({ offset: offset + rows.length } satisfies WorkdayCursor) : toJsonCursor({ offset: 0 } satisfies WorkdayCursor);
    return { entities, cursor, hasMore: more };
  };
}

/* ── Family composition ──────────────────────────────────────────────────────── */

const WORKDAY_REASONS = {
  unauthorized: 'Service not authorized — the Integration System User\'s security groups / domain policies cannot read this object (403)',
  unprovisioned: 'Object not available for this Workday tenant — the module (Recruiting / Benefits / Payroll / Learning / Absence) is not provisioned, or the REST service/version differs (404)',
} as const;

/** Wrap a pull so one unavailable object degrades instead of failing the whole family. */
function serviceResource(spec: WorkdaySpec): AdapterResource {
  return { id: spec.id, label: spec.label, kind: spec.kind, pull: graceful(makePull(spec), WORKDAY_REASONS) };
}

export const workdayAdapter: ConnectorAdapter = {
  connectorId: 'workday',
  baseHeaders: { Accept: 'application/json' },
  resources: SPECS.map(serviceResource),
};

/* ── Service catalog (reference; NO scope projection — access is ISU-security-governed, like Salesforce) ── */

/** A Workday service (object) in the family. */
export interface WorkdayService {
  id: string;
  label: string;
  /** The REST resource this object reads. */
  resource: string;
  /** The UDM kind it produces. */
  kind: UnifiedEntityKind;
}

/**
 * The service catalog — one entry per object, ids matching the `AdapterResource.id` so the Enterprise
 * Connector Center shows a live object count per service. Unlike the scope-gated families (Google / GitHub
 * / Slack / Atlassian / HubSpot), Workday has no per-object OAuth scope that maps to availability — the
 * functional-area scope is necessary but the Integration System User's security groups + domain security
 * policies are the real gate. So — exactly like Salesforce / ServiceNow / SAP / Oracle / Dynamics — there is
 * no `workdayServiceAvailability(grantedScopes)` projection and no `serviceCapabilities` branch. The generic
 * fallback is correct, and which modules (HR / Payroll / Benefits / Recruiting / Learning / Time Tracking /
 * Absence / Compensation) a tenant exposes is discovered live from the per-module degrade.
 */
export const WORKDAY_SERVICES: WorkdayService[] = SPECS.map((sp) => ({
  id: sp.id,
  label: sp.label,
  resource: sp.resource,
  kind: sp.kind,
}));
