/**
 * P6.8 — Snowflake automation actions through the SHARED confirmation-gated executor. Proves: the gate refuses a
 * mutation without `confirmed` (and never runs SQL), each action builds the correct ALTER/EXECUTE statement
 * (warehouses bare, tasks/pipes fully-qualified), the STRICT identifier validator fails closed on any
 * SQL-injection attempt BEFORE a statement is built, the started→completed|failed audit fan-out, and 403
 * classification. Pure-node; the SQL transport is faked.
 */
import { describe, expect, it } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest, PlatformEventInput } from '@neuropause/shared';
import { AuthError } from '../../unified/sync/http';
import { InfraActionExecutor } from '../executor';
import { SNOWFLAKE_ACTIONS } from './snowflakeActions';

const NOW = '2026-07-13T00:00:00.000Z';
const OK = JSON.stringify({ message: 'Statement executed successfully.', statementHandle: 'h' });

function harness(router: (req: DiscoveryRequest) => { status?: number; text?: string; error?: Error }) {
  const events: PlatformEventInput[] = [];
  const requests: DiscoveryRequest[] = [];
  const http: DiscoveryHttp = {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      requests.push(req);
      const r = router(req);
      if (r.error) throw r.error;
      return { status: r.status ?? 200, headers: {}, text: r.text ?? OK };
    },
  };
  const exec = new InfraActionExecutor(
    { makeHttp: () => http, publish: (e) => events.push(e), regionFor: () => null, ownsAccount: () => true, /* P13C R7 — these suites act AS the owning tenant; cross-tenant refusal is asserted in infrastructureTenancy.test.ts */ now: () => NOW },
    SNOWFLAKE_ACTIONS,
  );
  return { exec, events, requests };
}
const types = (events: PlatformEventInput[]): string[] => events.map((e) => e.type);
const stmtOf = (req: DiscoveryRequest): string => (JSON.parse(req.body ?? '{}') as { statement?: string }).statement ?? '';

describe('confirmation gate', () => {
  it('refuses a mutating action without confirmation and NEVER runs SQL', async () => {
    const { exec, events, requests } = harness(() => ({ text: OK }));
    const res = await exec.execute('snowflake', 'acct1', 'sf_warehouse_suspend', { warehouse: 'COMPUTE_WH' }, false);
    expect(res.ok).toBe(false);
    expect(res.requiresConfirmation).toBe(true);
    expect(requests).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

describe('warehouse + task + pipe statements', () => {
  it('Resume / Suspend Warehouse build the ALTER WAREHOUSE statements and audit started→completed', async () => {
    const { exec, events, requests } = harness(() => ({ text: OK }));
    await exec.execute('snowflake', 'acct1', 'sf_warehouse_resume', { warehouse: 'COMPUTE_WH' }, true);
    expect(stmtOf(requests[0])).toBe('ALTER WAREHOUSE COMPUTE_WH RESUME IF SUSPENDED');
    await exec.execute('snowflake', 'acct1', 'sf_warehouse_suspend', { warehouse: 'COMPUTE_WH' }, true);
    expect(stmtOf(requests[1])).toBe('ALTER WAREHOUSE COMPUTE_WH SUSPEND');
    expect(types(events).slice(0, 2)).toEqual(['infrastructure.action_started', 'infrastructure.action_completed']);
  });

  it('Execute Task / Set Task State fully-qualify the task name', async () => {
    const { exec, requests } = harness(() => ({ text: OK }));
    await exec.execute('snowflake', 'acct1', 'sf_task_execute', { database: 'PROD_DB', schema: 'PUBLIC', task: 'DAILY_LOAD' }, true);
    expect(stmtOf(requests[0])).toBe('EXECUTE TASK PROD_DB.PUBLIC.DAILY_LOAD');
    await exec.execute('snowflake', 'acct1', 'sf_task_set_state', { database: 'PROD_DB', schema: 'PUBLIC', task: 'DAILY_LOAD', state: 'resume' }, true);
    expect(stmtOf(requests[1])).toBe('ALTER TASK PROD_DB.PUBLIC.DAILY_LOAD RESUME');
  });

  it('Refresh Pipe fully-qualifies the pipe name', async () => {
    const { exec, requests } = harness(() => ({ text: OK }));
    await exec.execute('snowflake', 'acct1', 'sf_pipe_refresh', { database: 'PROD_DB', schema: 'PUBLIC', pipe: 'INGEST_PIPE' }, true);
    expect(stmtOf(requests[0])).toBe('ALTER PIPE PROD_DB.PUBLIC.INGEST_PIPE REFRESH');
  });
});

describe('SQL-injection defense + classification', () => {
  it('rejects an identifier containing SQL metacharacters BEFORE building a statement', async () => {
    const { exec, requests, events } = harness(() => ({ text: OK }));
    const inj = await exec.execute('snowflake', 'acct1', 'sf_warehouse_suspend', { warehouse: 'WH; DROP TABLE T' }, true);
    expect(inj.message).toContain('Invalid warehouse name');
    const injTask = await exec.execute('snowflake', 'acct1', 'sf_task_execute', { database: 'PROD_DB', schema: 'PUBLIC', task: 'T"; SELECT' }, true);
    expect(injTask.message).toContain('Invalid task name');
    const badState = await exec.execute('snowflake', 'acct1', 'sf_task_set_state', { database: 'D', schema: 'S', task: 'T', state: 'DROP' }, true);
    expect(badState.message).toContain('Invalid state');
    expect(requests).toHaveLength(0); // fail closed — no SQL ever ran
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed', 'infrastructure.action_started', 'infrastructure.action_failed', 'infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('a provider 403 becomes a least-privilege message and audits started→failed', async () => {
    const { exec, events } = harness(() => ({ error: new AuthError('Forbidden', 403) }));
    const res = await exec.execute('snowflake', 'acct1', 'sf_warehouse_resume', { warehouse: 'COMPUTE_WH' }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Permission denied by the cloud provider');
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('lists exactly the five high-privilege Snowflake actions', () => {
    const { exec } = harness(() => ({ text: OK }));
    const cat = exec.list('snowflake');
    expect(cat.map((a) => a.id).sort()).toEqual(['sf_pipe_refresh', 'sf_task_execute', 'sf_task_set_state', 'sf_warehouse_resume', 'sf_warehouse_suspend'].sort());
    expect(cat.every((a) => a.mutates && a.platformId === 'snowflake')).toBe(true);
  });
});
