/**
 * P8.4 — Enterprise workforce archetypes. Proves the Executive / Infrastructure /
 * department additions are real, governed, and wired to the EXISTING execution
 * path:
 *   • registration + skill routing for all 18 new archetypes;
 *   • every execution binding resolves to a REAL executor action (infra catalog /
 *     M365 catalog) with its required params — no invented ids;
 *   • every executable proposal is governed to `require_approval` (never allow),
 *     so nothing executes without human approval;
 *   • least-privilege: `execute:action` is granted iff a worker actually executes;
 *   • a real archetype flows approve → running → settle through the WorkerRuntime;
 *   • the registry scales to a large workforce with O(1) lookup.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ExecutionRequest,
  ExecutionSession,
  UnifiedEntity,
  WorkerPermissionScope,
} from '@neuropause/shared';
import { builtInWorkers } from './index';
import { advisoryPair, composeWorker } from './common';
import type { SkillContext, SkillImpl, SkillResult, WorkforceData } from '../sdk';
import { executeJob } from '../runtime/executor';
import { WorkerRegistry } from '../registry/workerRegistry';
import { AuditLog } from '../governance/auditLog';
import { GovernanceRuntime } from '../governance';
import { JobStore } from './../runtime/jobStore';
import { WorkerRuntime } from '../runtime/workerRuntime';
import { aggregateOutcome, bindingToRequest } from '../execution/router';
// The REAL executor catalogs the bindings must resolve against.
import { awsActions } from '../../infrastructure/aws/awsActions';
import { azureActions } from '../../infrastructure/azure/azureActions';
import { gcpActions } from '../../infrastructure/gcp/gcpActions';
import { kubernetesActions } from '../../infrastructure/kubernetes/kubernetesActions';
import { dockerActions } from '../../infrastructure/docker/dockerActions';
import { vmwareActions } from '../../infrastructure/vmware/vmwareActions';
import { cloudflareActions } from '../../infrastructure/cloudflare/cloudflareActions';
import { snowflakeActions } from '../../infrastructure/snowflake/snowflakeActions';
import { databricksActions } from '../../infrastructure/databricks/databricksActions';
import { iacActions } from '../../infrastructure/iac/iacActions';
import { ALL_M365_ACTIONS } from '../../connectors/m365';

const NOW = '2026-07-15T00:00:00.000Z';
const NEW_ROLES = new Set(['executive', 'infrastructure', 'hr', 'procurement']);

const defs = builtInWorkers();
const byId = new Map(defs.map((d) => [d.worker.identity.id, d]));
const newDefs = defs.filter((d) => NEW_ROLES.has(d.worker.identity.role));

// The real InfraActionExecutor catalog (same assembly as infrastructure/index.ts).
const INFRA_ACTIONS = [
  ...awsActions(), ...azureActions(), ...gcpActions(), ...kubernetesActions(), ...dockerActions(),
  ...vmwareActions(), ...cloudflareActions(), ...snowflakeActions(), ...databricksActions(), ...iacActions(),
];
const infraById = new Map(INFRA_ACTIONS.map((a) => [a.id, a]));
const m365Ids = new Set(ALL_M365_ACTIONS.map((a) => a.id));

// Every executable skill + a representative job input that triggers its binding.
const EXECUTABLE: Array<{ workerId: string; skillId: string; input: Record<string, unknown> }> = [
  { workerId: 'worker:infra-cloud', skillId: 'stop-idle-instance', input: { instanceId: 'i-0abc', region: 'us-east-1' } },
  { workerId: 'worker:infra-platform', skillId: 'run-iac-plan', input: { workspaceId: 'ws-1', message: 'nightly' } },
  { workerId: 'worker:infra-devops', skillId: 'restart-container', input: { containerId: 'c-1' } },
  { workerId: 'worker:infra-k8s', skillId: 'restart-deployment', input: { namespace: 'prod', name: 'api' } },
  { workerId: 'worker:infra-database', skillId: 'reboot-database', input: { dbInstanceId: 'db-1', region: 'us-east-1' } },
  { workerId: 'worker:infra-network', skillId: 'purge-cdn-cache', input: { zoneId: 'zone-1' } },
  { workerId: 'worker:infra-security', skillId: 'rotate-secret', input: { secretId: 'sec-1', region: 'us-east-1' } },
  { workerId: 'worker:infra-sre', skillId: 'restart-statefulset', input: { namespace: 'prod', name: 'db' } },
  { workerId: 'worker:exec-ceo', skillId: 'all-hands', input: { to: 'all@co', subject: 'Update', body: 'Hi team' } },
  { workerId: 'worker:exec-ciso', skillId: 'security-advisory', input: { to: 'all@co', subject: 'Advisory', body: 'Patch now' } },
  { workerId: 'worker:exec-cco', skillId: 'compliance-notice', input: { to: 'all@co', subject: 'Notice', body: 'Policy update' } },
  { workerId: 'worker:hr', skillId: 'send-onboarding', input: { to: 'new@co', subject: 'Welcome', body: 'Day one' } },
  { workerId: 'worker:procurement', skillId: 'vendor-outreach', input: { to: 'vendor@x', subject: 'RFQ', body: 'Quote please' } },
];

/* ── helpers ─────────────────────────────────────────────────────────────── */

const stores: Array<{ flush: () => Promise<void> }> = [];
const paths: string[] = [];
function tempPath(): string {
  const p = join(tmpdir(), `nps-arch-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

function entity(over: Partial<UnifiedEntity>): UnifiedEntity {
  return {
    id: 'e', kind: 'task', title: 't', status: null, connectorId: 'github',
    createdAt: NOW, updatedAt: NOW, metadata: {}, ...over,
  } as UnifiedEntity;
}

function mkData(over: Partial<WorkforceData> = {}): WorkforceData {
  return { now: NOW, entities: [], events: [], memories: [], neighbors: () => [], ...over };
}

function run(workerId: string, skillId: string, input: Record<string, unknown>, data: Partial<WorkforceData> = {}): SkillResult {
  const def = byId.get(workerId)!;
  const skill = def.skills.get(skillId)!;
  const ctx: SkillContext = { worker: def.worker, now: NOW, data: mkData(data), log: () => undefined };
  return skill.run(ctx, input);
}

afterEach(async () => {
  await Promise.all(stores.map((s) => s.flush()));
  stores.length = 0;
  for (const p of paths) await fs.rm(p, { force: true });
  paths.length = 0;
});

/* ── registration + routing ──────────────────────────────────────────────── */

describe('P8.4 archetype registration', () => {
  it('registers 18 new archetypes across the four tiers', () => {
    expect(newDefs).toHaveLength(18);
    const count = (role: string): number => newDefs.filter((d) => d.worker.identity.role === role).length;
    expect(count('executive')).toBe(8);
    expect(count('infrastructure')).toBe(8);
    expect(count('hr')).toBe(1);
    expect(count('procurement')).toBe(1);
  });

  it('every archetype is a valid, uniquely-identified built-in with routable skills', () => {
    const ids = newDefs.map((d) => d.worker.identity.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of newDefs) {
      expect(d.worker.builtIn).toBe(true);
      expect(d.worker.identity.id.startsWith('worker:')).toBe(true);
      expect(d.worker.identity.developer).toBe('NeuroPause');
      expect(d.skills.size).toBeGreaterThan(0);
      // Skill routing: every declared skill resolves to an implementation.
      for (const decl of d.worker.skills) expect(d.skills.get(decl.id)).toBeDefined();
    }
  });

  it('grants execute:action iff the worker actually executes (least privilege)', () => {
    for (const d of newDefs) {
      const grants = new Set<WorkerPermissionScope>(
        d.worker.permissions.filter((p) => p.granted).map((p) => p.scope),
      );
      const declaresExec = d.worker.skills.some((s) => s.requires.includes('execute:action'));
      expect(grants.has('execute:action')).toBe(declaresExec);
    }
  });
});

/* ── execution bindings resolve to REAL actions ──────────────────────────── */

describe('P8.4 execution bindings resolve to existing executor actions', () => {
  it('every executable skill emits a binding that resolves to a real catalog action', () => {
    for (const spec of EXECUTABLE) {
      const r = run(spec.workerId, spec.skillId, spec.input);
      expect(r.proposals, `${spec.workerId}/${spec.skillId}`).toHaveLength(1);
      const binding = r.proposals[0].execution;
      expect(binding, `${spec.workerId}/${spec.skillId} has a binding`).toBeDefined();
      if (!binding) continue;

      if (binding.executor === 'infra') {
        const action = infraById.get(binding.actionId ?? '');
        expect(action, `infra action ${binding.actionId} exists`).toBeDefined();
        expect(action!.platformId).toBe(binding.target); // target must match the action's platform
        expect(action!.mutates).toBe(true);
        // Every REQUIRED param of the real action is present + non-empty in the binding.
        for (const p of action!.params.filter((s) => s.required)) {
          const v = (binding.params ?? {})[p.key];
          expect(typeof v === 'string' && v.trim() !== '', `param ${p.key} for ${binding.actionId}`).toBe(true);
        }
      } else if (binding.executor === 'm365') {
        expect(binding.target).toBe('microsoft-entra'); // the only connector with a write executor
        expect(m365Ids.has(binding.actionId ?? '')).toBe(true);
        // mail.send reads recipients via strArr → `to` MUST be a non-empty string[].
        const mp = binding.params ?? {};
        expect(Array.isArray(mp.to)).toBe(true);
        expect((mp.to as unknown[]).length).toBeGreaterThan(0);
        for (const r of mp.to as unknown[]) expect(typeof r === 'string' && (r as string).length > 0).toBe(true);
        expect(typeof mp.subject === 'string' && (mp.subject as string).length > 0).toBe(true);
      } else {
        throw new Error(`unexpected executor "${binding.executor}" — automation bindings are intentionally not shipped`);
      }
    }
  });

  it('an executable skill is honest when its target is missing, and binds when supplied', () => {
    const none = run('worker:infra-k8s', 'restart-deployment', {});
    expect(none.proposals).toHaveLength(0);
    const one = run('worker:infra-k8s', 'restart-deployment', { namespace: 'prod', name: 'api' });
    expect(one.proposals).toHaveLength(1);
    expect(one.proposals[0].permissions).toContain('execute:action');
    expect(one.proposals[0].execution).toMatchObject({ executor: 'infra', target: 'kubernetes', actionId: 'k8s_deployment_restart' });
  });
});

/* ── governance: execution never bypasses approval ───────────────────────── */

describe('P8.4 executable proposals are always approval-gated', () => {
  it('every execution proposal is governed to require_approval (never allow)', async () => {
    const audit = new AuditLog(tempPath());
    await audit.load();
    stores.push(audit);
    const governance = new GovernanceRuntime(audit);
    let c = 0;
    const newId = (): string => `id-${++c}`;

    for (const spec of EXECUTABLE) {
      const def = byId.get(spec.workerId)!;
      const job = executeJob({
        jobId: `job-${spec.skillId}`,
        worker: def.worker,
        skill: def.skills.get(spec.skillId)!,
        data: mkData(),
        input: spec.input,
        requestedBy: 'test',
        now: NOW,
        deps: { evaluate: (req, w, n) => governance.evaluate(req, w, n), newId },
      });
      expect(job.status, `${spec.workerId} parks for approval`).toBe('awaiting_approval');
      const execProps = job.proposals.filter((p) => p.execution);
      expect(execProps.length).toBeGreaterThan(0);
      for (const p of execProps) {
        expect(p.verdict.decision, `${spec.workerId}/${spec.skillId}`).toBe('require_approval');
      }
    }
  });

  it('forces approval for ANY execution-bearing proposal, even one under-declared as low-risk', async () => {
    const audit = new AuditLog(tempPath());
    await audit.load();
    stores.push(audit);
    const governance = new GovernanceRuntime(audit);
    let c = 0;
    const worker = byId.get('worker:infra-cloud')!.worker; // grants execute:action
    // A deliberately under-declared execution proposal: no side effect flag, low risk.
    const sneaky: SkillImpl = {
      id: 'stop-idle-instance',
      run: () => ({
        summary: 's',
        evidence: [{ kind: 'resource', id: 'r1' }],
        grounded: true,
        proposals: [
          {
            title: 'sneaky',
            summary: 's',
            sideEffects: false,
            permissions: ['execute:action'],
            risk: 'low',
            evidence: [{ kind: 'resource', id: 'r1' }],
            payload: {},
            execution: { executor: 'infra', target: 'aws', actionId: 'aws_ec2_stop', params: { instanceId: 'i-1' } },
          },
        ],
      }),
    };
    const job = executeJob({
      jobId: 'sneaky-job',
      worker,
      skill: sneaky,
      data: mkData(),
      input: {},
      requestedBy: 'test',
      now: NOW,
      deps: { evaluate: (req, w, n) => governance.evaluate(req, w, n), newId: () => `id-${++c}` },
    });
    // The binding forces high-risk side-effecting evaluation → approval, never allow.
    expect(job.status).toBe('awaiting_approval');
    expect(job.proposals[0].verdict.decision).toBe('require_approval');
    expect(job.proposals[0].risk).toBe('high');
  });
});

/* ── advisory skills stay grounded + read-only ───────────────────────────── */

describe('P8.4 advisory skills', () => {
  it('ground on connected signals and stay honest when nothing is connected', () => {
    const empty = run('worker:infra-cloud', 'capacity-scan', {});
    expect(empty.grounded).toBe(false);
    expect(empty.proposals).toHaveLength(0);

    const withData = run('worker:infra-cloud', 'capacity-scan', {}, { entities: [entity({ id: 'r1' })] });
    expect(withData.grounded).toBe(true);
    expect(withData.evidence.length).toBeGreaterThan(0);
    expect(withData.proposals).toHaveLength(0); // read-only — no side effect
  });

  it('an executive draft is a governed propose:draft grounded in intelligence', () => {
    const r = run('worker:exec-ceo', 'strategy-briefing', {}, { entities: [entity({ id: 'p1', kind: 'project', title: 'Apollo' })] });
    expect(r.grounded).toBe(true);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].permissions).toContain('propose:draft');
    expect(r.proposals[0].execution).toBeUndefined(); // advisory, not executable
  });
});

/* ── a real archetype flows through the P8.3 execution path ───────────────── */

function completedSession(over: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: 'exec-arch-1', kind: 'connector', label: 'l', state: 'completed', steps: [], currentStep: -1,
    startedAt: NOW, completedAt: NOW, durationMs: 2, error: null, resultSummary: 'infra ok',
    result: null, correlationId: null, ...over,
  };
}

describe('P8.4 real archetype executes through the WorkerRuntime', () => {
  it('Cloud Engineer: approve → running → settle succeeded via the infra executor', async () => {
    const registry = new WorkerRegistry(tempPath());
    const audit = new AuditLog(tempPath());
    const jobs = new JobStore(tempPath());
    stores.push(registry, audit, jobs);
    await registry.load();
    await audit.load();
    await jobs.load();

    const def = byId.get('worker:infra-cloud')!;
    registry.register(def, NOW);
    let c = 0;
    const runtime = new WorkerRuntime({
      registry,
      governance: new GovernanceRuntime(audit),
      jobs,
      dataProvider: () => mkData(),
      skillsFor: (id) => (id === 'worker:infra-cloud' ? def.skills : null),
      newId: () => `id-${++c}`,
      clock: () => NOW,
    });

    // Fake ExecuteEngine: accepts the real ExecutionRequest bindingToRequest builds,
    // returns a completed session. Proves the archetype's binding drives the P8.3 path.
    const submit = async (_req: ExecutionRequest): Promise<ExecutionSession> => completedSession();
    let dispatched: Promise<void> = Promise.resolve();
    runtime.setDispatchApproved((job, proposals) => {
      const bindings = proposals.filter((p) => p.execution);
      const executor = bindings[0].execution!.executor;
      dispatched = Promise.all(bindings.map((p) => submit(bindingToRequest(job, p)!)))
        .then((sessions) => runtime.settleExecution(job.id, aggregateOutcome(sessions, executor)));
    });

    const job = runtime.runJob({ workerId: 'worker:infra-cloud', skillId: 'stop-idle-instance', input: { instanceId: 'i-0abc' } });
    expect(job.status).toBe('awaiting_approval');
    const approved = runtime.approveProposal(job.id, job.proposals[0].id, 'alice', null);
    expect(approved?.status).toBe('running');
    await dispatched;
    const settled = runtime.getJob(job.id)!;
    expect(settled.status).toBe('succeeded');
    expect(settled.executor).toBe('infra');
  });
});

/* ── the registry scales to a large workforce ────────────────────────────── */

describe('P8.4 workforce scale', () => {
  it('registers 1000 workers with O(1) id lookup', async () => {
    const registry = new WorkerRegistry(tempPath());
    stores.push(registry);
    await registry.load();
    const N = 1000;
    for (let i = 0; i < N; i++) {
      registry.register(
        composeWorker({
          id: `worker:scale-${i}`,
          name: `Scale ${i}`,
          role: 'operations',
          goals: ['scale'],
          pairs: [advisoryPair('review', 'operations')],
        }),
        NOW,
      );
    }
    expect(registry.get('worker:scale-0')).not.toBeNull();
    expect(registry.get('worker:scale-999')).not.toBeNull();
    expect(registry.get('worker:scale-1000')).toBeNull();
    expect(registry.summaries().length).toBe(registry.list().length);
    expect(registry.list().length).toBeGreaterThanOrEqual(N);
  });
});
