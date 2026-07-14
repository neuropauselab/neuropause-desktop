/**
 * P6.8 — Snowflake automation actions (HIGH PRIVILEGE).
 *
 * Confirmation-gated mutations against Snowflake over the SAME SQL transport discovery uses: resume / suspend a
 * warehouse, execute a task, resume / suspend a task, and refresh a pipe. Every one is `mutates: true`, so the
 * shared `InfraActionExecutor` refuses it without an explicit human confirmation and AI can never reach it.
 * Discovery runs read-only `SHOW` statements; these actions are the only `ALTER`/`EXECUTE` writes, and the
 * discovery user's Snowflake role governs whether they run (a denial surfaces as a least-privilege message).
 *
 * SQL-INJECTION DEFENSE (the load-bearing control): an object name is interpolated into a SQL statement, so EVERY
 * identifier is validated against the strict unquoted-identifier charset (`^[A-Za-z_][A-Za-z0-9_$]*$`) BEFORE it
 * reaches the statement — the charset excludes quotes, whitespace, semicolons, and every other SQL metacharacter,
 * so no injection is possible. Tasks and pipes are addressed by their fully-qualified `DB.SCHEMA.NAME` (each part
 * validated), since discovery finds them account-wide; warehouses take a bare name.
 */
import { snowflakeExec } from './snowflakeClient';
import { reqStr, InfraActionInputError, type InfraAction } from '../actionSdk';

/* ── strict validators (fail closed BEFORE any statement is built) ───────────────────────────────── */

/** A Snowflake unquoted identifier — the ONLY names allowed into a statement (no quotes/space/`;`/metachars). */
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;
function ident(v: string, what: string): string {
  if (v.length > 255 || !IDENT_RE.test(v)) throw new InfraActionInputError(`Invalid ${what} "${v}"`);
  return v;
}
/** A fully-qualified `DB.SCHEMA.NAME` — each part independently validated, then joined. */
function qualified(db: string, schema: string, name: string, what: string): string {
  return `${ident(db, `${what} database`)}.${ident(schema, `${what} schema`)}.${ident(name, `${what} name`)}`;
}
function taskState(v: string): 'RESUME' | 'SUSPEND' {
  const t = v.trim().toUpperCase();
  if (t !== 'RESUME' && t !== 'SUSPEND') throw new InfraActionInputError(`Invalid state "${v}" (use "resume" or "suspend")`);
  return t;
}

export const SNOWFLAKE_ACTIONS: InfraAction[] = [
  {
    id: 'sf_warehouse_resume', label: 'Resume Warehouse', platformId: 'snowflake', domain: 'compute',
    description: 'Resumes a suspended virtual warehouse (idempotent — RESUME IF SUSPENDED).', mutates: true, risk: 'medium', targetResourceType: 'warehouse',
    params: [{ key: 'warehouse', label: 'Warehouse', required: true, hint: 'COMPUTE_WH' }],
    run: async (ctx, p) => {
      const wh = ident(reqStr(p, 'warehouse'), 'warehouse name');
      await snowflakeExec(ctx.http, `ALTER WAREHOUSE ${wh} RESUME IF SUSPENDED`);
      return { ok: true, summary: `Resumed warehouse ${wh}`, data: { warehouse: wh } };
    },
  },
  {
    id: 'sf_warehouse_suspend', label: 'Suspend Warehouse', platformId: 'snowflake', domain: 'compute',
    description: 'Suspends a running virtual warehouse (stops compute billing).', mutates: true, risk: 'medium', targetResourceType: 'warehouse',
    params: [{ key: 'warehouse', label: 'Warehouse', required: true, hint: 'COMPUTE_WH' }],
    run: async (ctx, p) => {
      const wh = ident(reqStr(p, 'warehouse'), 'warehouse name');
      await snowflakeExec(ctx.http, `ALTER WAREHOUSE ${wh} SUSPEND`);
      return { ok: true, summary: `Suspended warehouse ${wh}`, data: { warehouse: wh } };
    },
  },
  {
    id: 'sf_task_execute', label: 'Execute Task', platformId: 'snowflake', domain: 'serverless',
    description: 'Triggers an immediate run of a task, outside its schedule.', mutates: true, risk: 'high', targetResourceType: 'task',
    params: [
      { key: 'database', label: 'Database', required: true, hint: 'PROD_DB' },
      { key: 'schema', label: 'Schema', required: true, hint: 'PUBLIC' },
      { key: 'task', label: 'Task', required: true, hint: 'DAILY_LOAD' },
    ],
    run: async (ctx, p) => {
      const task = qualified(reqStr(p, 'database'), reqStr(p, 'schema'), reqStr(p, 'task'), 'task');
      await snowflakeExec(ctx.http, `EXECUTE TASK ${task}`);
      return { ok: true, summary: `Executed task ${task}`, data: { task } };
    },
  },
  {
    id: 'sf_task_set_state', label: 'Resume / Suspend Task', platformId: 'snowflake', domain: 'serverless',
    description: 'Resumes or suspends a scheduled task.', mutates: true, risk: 'high', targetResourceType: 'task',
    params: [
      { key: 'database', label: 'Database', required: true, hint: 'PROD_DB' },
      { key: 'schema', label: 'Schema', required: true, hint: 'PUBLIC' },
      { key: 'task', label: 'Task', required: true, hint: 'DAILY_LOAD' },
      { key: 'state', label: 'State (resume/suspend)', required: true, hint: 'resume' },
    ],
    run: async (ctx, p) => {
      const task = qualified(reqStr(p, 'database'), reqStr(p, 'schema'), reqStr(p, 'task'), 'task');
      const state = taskState(reqStr(p, 'state'));
      await snowflakeExec(ctx.http, `ALTER TASK ${task} ${state}`);
      return { ok: true, summary: `${state === 'RESUME' ? 'Resumed' : 'Suspended'} task ${task}`, data: { task, state } };
    },
  },
  {
    id: 'sf_pipe_refresh', label: 'Refresh Pipe', platformId: 'snowflake', domain: 'serverless',
    description: 'Refreshes a pipe — queues staged files for a Snowpipe load.', mutates: true, risk: 'medium', targetResourceType: 'pipe',
    params: [
      { key: 'database', label: 'Database', required: true, hint: 'PROD_DB' },
      { key: 'schema', label: 'Schema', required: true, hint: 'PUBLIC' },
      { key: 'pipe', label: 'Pipe', required: true, hint: 'INGEST_PIPE' },
    ],
    run: async (ctx, p) => {
      const pipe = qualified(reqStr(p, 'database'), reqStr(p, 'schema'), reqStr(p, 'pipe'), 'pipe');
      await snowflakeExec(ctx.http, `ALTER PIPE ${pipe} REFRESH`);
      return { ok: true, summary: `Refreshed pipe ${pipe}`, data: { pipe } };
    },
  },
];

/** Bind the Snowflake actions (used by the executor registration in the runtime composition root). */
export function snowflakeActions(): InfraAction[] {
  return SNOWFLAKE_ACTIONS;
}
