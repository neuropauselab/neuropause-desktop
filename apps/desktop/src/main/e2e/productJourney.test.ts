/**
 * P13C ROUND 37 — GATE 18. THE PRODUCT JOURNEY, END TO END, OVER REAL PARTS.
 *
 * One user's first day, walked through the REAL production classes over real
 * files in one temp install — no mocks of product behavior anywhere, only the
 * Electron transport (the same substitution every certification suite makes):
 *
 *   fresh install → onboarding (profile + the tenant AI privacy choice) →
 *   AI routing actually clamped by that choice → sign-in claims the owner →
 *   a person is added → a workspace is created and switched to through the
 *   real membership gate → a business record exists → a data file is
 *   imported through the real analyze→plan→import pipeline → history and
 *   audit show it → it exports → the assistant answers fail-closed with
 *   honest provenance → THE APP "RESTARTS" (every store rebuilt from the
 *   same bytes) → everything the user did is still there.
 *
 * The restart phase is the point: Gate 18's question is not "do the parts
 * work" (their suites say so) but "does the WHOLE day survive the product's
 * own persistence, in sequence, in one world".
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  EnterpriseModuleDescriptor,
  EnterprisePermission,
  TenantScope,
} from '@neuropause/shared';
import { IpcChannel, planRoute } from '@neuropause/shared';

// The one substitution: Electron's shell (same mock every store suite uses).
const mockState = vi.hoisted(() => ({ userDataDir: '', enc: true }));
vi.mock('electron', () => ({
  app: { getPath: () => mockState.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => mockState.enc,
    encryptString: (s: string) => Buffer.from(`enc::${s}`, 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8');
      if (!s.startsWith('enc::')) throw new Error('decrypt failed');
      return s.slice(5);
    },
  },
}));

import { createExperienceProfileService } from '../onboarding/experienceProfileService';
import { resumeStep } from '../../renderer/src/firstRun/experienceModel';
import { TenantAiPreferenceStore } from '../ai/tenantAiPreferenceStore';
import { tenantAiPreferenceStore as prefSingleton } from '../ai/tenantAiPreferenceInstance';
import { saveAiConfig } from '../ai/aiConfigStore';
import { assembleRouteCandidates } from '../ai/providerManager';
import { AiEngine } from '../ai/aiEngine';
import { createBootRouter } from '../ai/provider';
import { OrgStore } from '../enterprise/org/orgStore';
import { WorkspaceStore } from '../enterprise/workspace/workspaceStore';
import { GovernanceStore } from '../enterprise/governance/governanceStore';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { createTenantContextResolver } from '../tenancy/tenantContext';
import { initDataPlane, type DataPlaneSubsystem } from '../dataPlane/index';
import { buildXlsx } from '../dataPlane/testFixtures';

const NOW = '2026-08-15T09:00:00.000Z';
const OWNER_EMAIL = 'founder@journey.example';

/** The world — one install's files, rebuilt wholesale for the restart phase. */
interface World {
  profile: ReturnType<typeof createExperienceProfileService>;
  prefs: TenantAiPreferenceStore;
  org: OrgStore;
  workspaces: WorkspaceStore;
  governance: GovernanceStore;
  crm: EnterpriseRecordStore;
  dataPlane: DataPlaneSubsystem;
}

let dir = '';
let scope: TenantScope | null = null;
const scopeSource = (): TenantScope | null => scope;

const CRM_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: 'crm-customers',
  title: 'Customers',
  singular: 'Customer',
  plural: 'Customers',
  icon: 'user',
  description: 'Customer master data.',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'text' },
  ],
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
};

const GRANTED = new Set<EnterprisePermission>([
  'data:read',
  'data:import',
  'data:approve',
  'data:export',
  'crm:read',
  'crm:manage',
] as EnterprisePermission[]);

const exported: { name: string; bytes: number }[] = [];

async function buildWorld(): Promise<World> {
  const profile = createExperienceProfileService({ filePath: join(dir, 'experience-profile.json') });
  await profile.load();
  const prefs = new TenantAiPreferenceStore(join(dir, 'tenant-ai-preference.json')).bindScope(scopeSource);
  const org = new OrgStore(join(dir, 'org.json'));
  org.bindScope(scopeSource);
  await org.load();
  const workspaces = new WorkspaceStore(join(dir, 'enterprise-workspaces.json'));
  await workspaces.load();
  const governance = new GovernanceStore(join(dir, 'governance.json'));
  governance.bindScope(scopeSource);
  await governance.load();
  const crm = new EnterpriseRecordStore(join(dir, 'enterprise-module-crm-customers.json'), 'crm-customers', 'account');
  crm.bindScope(scopeSource);
  await crm.load();
  const dataPlane = initDataPlane({
    userDataDir: dir,
    storeFor: (moduleId) => (moduleId === 'crm-customers' ? crm : null),
    actor: () => OWNER_EMAIL,
    tenantId: () => scope?.tenantId ?? '',
    now: () => NOW,
    audit: (e) => governance.record({ actor: OWNER_EMAIL, action: e.action, target: e.target, summary: e.summary, workspaceId: scope?.workspaceId ?? '' }, NOW),
    authorize: (permission) => {
      if (!GRANTED.has(permission)) {
        const err = new Error(`Missing permission ${permission}`);
        err.name = 'AuthorizationError';
        throw err;
      }
    },
    modules: () => [CRM_DESCRIPTOR],
    saveExport: async (name, _format, content) => {
      exported.push({ name, bytes: content.length });
      return join(dir, name);
    },
    onImported: () => undefined,
  });
  return { profile, prefs, org, workspaces, governance, crm, dataPlane };
}

function dpHandler(world: World, channel: string): (p: unknown) => unknown {
  const def = world.dataPlane.handlers.find((h) => h.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => unknown;
}

let world: World;

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), `np-journey-${randomUUID().slice(0, 8)}-`));
  mockState.userDataDir = dir;
  world = await buildWorld();
});

afterAll(async () => {
  prefSingleton.bindScope(() => null);
  await fs.rm('tenant-ai-preference.json', { force: true }).catch(() => undefined);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe('the product journey — one user, one day, one install', () => {
  it('PHASE 1 — fresh install: the seeded world, nothing invented', async () => {
    expect(world.profile.get().state).toBe('pending');
    expect(world.org.defaultOrg().id).toBe('org-default');
    expect(world.workspaces.activeWorkspaceIdOrNull()).toBe('workspace-default');
    // The seeded owner ships UNCLAIMED — first-claim-wins is still open.
    expect(world.org.user('user-owner')?.email).toBeNull();
    scope = { tenantId: 'org-default', workspaceId: 'workspace-default' };
  });

  it('PHASE 2 — onboarding: the privacy choice and the profile, persisted per step', async () => {
    // "On this device" — the tenant preference, exactly as first-run writes it.
    await world.prefs.setMine('local_only', Date.parse(NOW));
    await world.profile.set({ aiModeChosen: true });
    await world.profile.set({ workspaceType: 'business' });
    // A quit here resumes at discovery — the Gate-13 rule, exercised in-journey.
    expect(resumeStep(world.profile.get())).toBe('discovery');
    await world.profile.set({
      attributes: [
        { key: 'context', label: 'Your context', value: 'Business', status: 'stated', source: 'setup', updatedAt: NOW },
      ],
      state: 'completed',
    });
    expect(world.profile.get().state).toBe('completed');
  });

  it('PHASE 3 — the privacy choice CLAMPS real routing (the round-34 promise, in the journey)', async () => {
    // Platform config would allow external (a cloud key exists in env terms);
    // the tenant chose local_only. The SINGLETON is what the router reads.
    saveAiConfig({ provider: 'claude' });
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-journey-key');
    prefSingleton.bindScope(scopeSource);
    await prefSingleton.setMine('local_only', Date.parse(NOW));
    try {
      const { mode, candidates } = await assembleRouteCandidates();
      expect(mode).toBe('local_only');
      const plan = planRoute(mode, candidates);
      expect(plan.attempts.every((a) => a.location !== 'external')).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('PHASE 4 — sign-in claims the owner; a person joins; a workspace is created and switched to', async () => {
    expect(world.org.claimOwnerIdentity({ name: 'Founder', email: OWNER_EMAIL })).toBe(true);
    const person = world.org.createUser({
      orgId: 'org-default',
      name: 'Ada Journey',
      email: 'ada@journey.example',
      title: 'Engineer',
    });
    expect(world.org.user(person.id)?.email).toBe('ada@journey.example');

    const ws = world.workspaces.create('Operations', 'org-default');
    // The REAL membership gate decides the switch, from the same stores.
    const resolver = createTenantContextResolver({
      sessionEmail: () => OWNER_EMAIL,
      isLoaded: () => true,
      activeWorkspaceId: () => world.workspaces.activeWorkspaceIdOrNull(),
      workspace: (id) => world.workspaces.get(id),
      organization: (id) => (id === 'org-default' ? world.org.defaultOrg() : null),
      usersFor: (orgId) => world.org.usersFor(orgId),
      rolesFor: (orgId) => world.org.rolesFor(orgId),
      ownerMember: () => world.org.user('user-owner'),
    });
    const verdict = resolver.canSwitchTo(ws);
    expect(verdict.ok).toBe(true);
    expect(world.workspaces.switch(ws.id)?.id).toBe(ws.id);
    scope = { tenantId: 'org-default', workspaceId: ws.id };
    world.governance.record(
      { actor: OWNER_EMAIL, action: 'workspace.switch', target: ws.id, summary: 'Switched to Operations', workspaceId: ws.id },
      NOW,
    );
  });

  it('PHASE 5 — business: a real record through the real store', async () => {
    const rec = world.crm.create({
      title: 'Globex Ltd',
      fields: { name: 'Globex Ltd', email: 'ops@globex.example' },
      actor: OWNER_EMAIL,
      now: NOW,
    });
    expect(world.crm.get(rec.id)?.title).toBe('Globex Ltd');
    await world.crm.flush();
  });

  it('PHASE 6 — data: import through the real pipeline; history and audit say so; it exports', async () => {
    const workbook = buildXlsx([
      { name: 'Customers', rows: [['Name', 'Email'], ['Initech', 'it@initech.example']] },
    ]);
    const plan = (await dpHandler(world, IpcChannel.DataPlaneAnalyze)({
      filename: 'customers.xlsx',
      contentBase64: workbook.toString('base64'),
    })) as { planId: string; tables: { tableName: string }[] };
    expect(plan.tables[0]?.tableName).toBe('Customers');

    const run = (await dpHandler(world, IpcChannel.DataPlaneImport)({
      planId: plan.planId,
      approvals: [{ tableName: 'Customers', approved: true }],
    })) as { status: string; totals: { imported: number } };
    expect(run.status).toBe('imported');
    expect(run.totals.imported).toBe(1);

    const history = (await dpHandler(world, IpcChannel.DataPlaneHistory)({})) as { planId: string }[];
    expect(history[0]?.planId).toBe(plan.planId);

    // The governance audit carries the import — the same trail Administration shows.
    expect(world.governance.auditEntries(20).some((a) => /import/i.test(a.action))).toBe(true);

    const exportRun = (await dpHandler(world, IpcChannel.DataPlaneExport)({
      moduleId: 'crm-customers',
      format: 'csv',
    })) as { records: number; filePath: string | null; cancelled: boolean };
    expect(exportRun.cancelled).toBe(false);
    expect(exportRun.records).toBeGreaterThan(0);
    expect(exportRun.filePath).not.toBeNull();
    expect(exported.length).toBeGreaterThan(0);
  });

  it('PHASE 7 — assistant: fail-closed with honest provenance (no key, no lie)', async () => {
    const engine = new AiEngine({ router: createBootRouter() });
    const res = await engine.run({
      worker: 'journey',
      promptId: 'engineering.summary',
      variables: { subject: 'my first day' },
    });
    // The deterministic floor answers with a structured fallback: model 'none',
    // zero confidence, and provenance that never pretends a model ran.
    expect(res.model).toBe('none');
    expect(res.routing?.location).toBe('none');
    expect(res.routing?.provider).toBe('none');
  });

  it('PHASE 8 — RESTART: every store rebuilt from the same bytes; the day survives', async () => {
    await world.org.flush();
    await world.workspaces.flush();
    await world.governance.flush();
    await world.crm.flush();

    const reopened = await buildWorld();

    // Onboarding stays completed — no takeover replay.
    expect(reopened.profile.get().state).toBe('completed');
    expect(reopened.profile.get().workspaceType).toBe('business');
    // The privacy choice survives — and still clamps.
    expect(reopened.prefs.mine()?.mode).toBe('local_only');
    // The owner claim and the added person survive.
    expect(reopened.org.user('user-owner')?.email).toBe(OWNER_EMAIL);
    expect(reopened.org.usersFor('org-default').some((u) => u.email === 'ada@journey.example')).toBe(true);
    // The created workspace is still the ACTIVE one.
    const activeId = reopened.workspaces.activeWorkspaceIdOrNull();
    expect(reopened.workspaces.get(activeId ?? '')?.name).toBe('Operations');
    // The business record survives.
    expect(reopened.crm.list().some((r) => r.title === 'Globex Ltd')).toBe(true);
    // The imported record survives IN the module store.
    expect(reopened.crm.list().some((r) => r.title === 'Initech')).toBe(true);
    // History survives through the provenance store on disk.
    const history = (await dpHandler(reopened, IpcChannel.DataPlaneHistory)({})) as unknown[];
    expect(history.length).toBeGreaterThan(0);
    // The audit trail survives AND its hash chain still verifies.
    expect(reopened.governance.auditEntries(50).length).toBeGreaterThan(0);
    expect(reopened.governance.verifyAuditIntegrity().ok).toBe(true);
  });
});
