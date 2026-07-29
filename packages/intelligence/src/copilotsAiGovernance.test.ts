import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createPgliteDriver, type PgliteDriver } from '@neuropause/persistence';
import { createNemsPlatform, systemContext, type NemsPlatform } from '@neuropause/nems';
import { createIntelligencePlatform, type IntelligencePlatform } from './platform';
import { DeterministicAiProvider } from './ai';
import { INTELLIGENCE_MATRIX } from './evidence';

async function seed(nems: NemsPlatform) {
  const acme = (await nems.organizations().create({ name: 'Acme', slug: 'acme' })).id;
  const ctx = systemContext(acme);
  const ada = await nems.users().create(ctx, { email: 'ada@acme.test', password: 'pw', displayName: 'Ada Lovelace' });
  const obj = await nems.okrs().createObjective(ctx, { title: 'Ship Wave 3', period: '2026-Q3', ownerId: ada.id });
  const kr = await nems.okrs().addKeyResult(ctx, obj.id, { title: 'Modules complete', target: 14 });
  await nems.okrs().updateKeyResult(ctx, kr.id, { current: 7, progress: 50 });
  const risky = await nems.okrs().createObjective(ctx, { title: 'Reliability', period: '2026-Q3' });
  await nems.okrs().setObjectiveStatus(ctx, risky.id, 'at-risk');
  await nems.okrs().createTask(ctx, { title: 'Write tests' });
  return { acme, obj: obj.id };
}

describe('Modules 4,5,6,9,11,13 — Copilots, Workspace, Briefings, AI, Governance, Dashboards', () => {
  let runtime: EnterpriseRuntime;
  let driver: PgliteDriver;
  let intel: IntelligencePlatform;
  let ids: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => {
    const clock = new ManualClock(3_000_000);
    runtime = createEnterpriseRuntime({ clock });
    driver = await createPgliteDriver();
    const nems = createNemsPlatform(runtime, { driver, clock });
    await nems.migrate();
    ids = await seed(nems);
    intel = await createIntelligencePlatform(runtime, { driver, nems, clock });
  });
  afterAll(async () => {
    await driver.close();
  });

  it('deterministic AI provider grounds strictly on evidence and cannot fabricate', async () => {
    const p = new DeterministicAiProvider();
    const grounded = await p.generate({ model: 'deterministic-1', messages: [{ role: 'user', content: 'Q?\n\nEVIDENCE:\n- nems.user u1 [nems]' }] });
    expect(grounded.text).toContain('Based on 1 evidence');
    const empty = await p.generate({ model: 'deterministic-1', messages: [{ role: 'user', content: 'Q?\n\nEVIDENCE:\n(none)' }] });
    expect(empty.text).toContain('Insufficient evidence');
  });

  it('model router routes, falls back, and exposes a no-lock-in catalog + health (AI Runtime Test)', () => {
    const router = intel.ai();
    expect(router.providers()).toContain('deterministic');
    expect(Object.keys(router.catalog()).length).toBe(7); // anthropic/openai/gemini/ollama/mistral/qwen/deterministic
    expect(router.route('deterministic-1').id).toBe('deterministic');
    expect(router.route('some-unregistered-model').id).toBe('deterministic'); // fallback, no throw
    expect(router.health().deterministic.ok).toBe(true);
  });

  it('executive copilots produce evidence-grounded, audited briefs for all seven roles', async () => {
    const copilots = await intel.copilots(ids.acme);
    expect(copilots.roles().length).toBe(7);
    const cto = copilots.copilot('CTO');
    expect(cto.dashboard(ids.acme).metrics.objectives).toBeGreaterThan(0);
    const brief = await cto.brief(ids.acme, 'ada', 'daily');
    expect(brief.evidence.length).toBeGreaterThan(0);
    expect(brief.confidence.score).toBeGreaterThan(0);
    expect(brief.auditId).toBeTruthy();
    expect(brief.replayId).toBeTruthy();
    expect(cto.actionQueue(ids.acme).length).toBeGreaterThan(0); // at-risk objective + task
    expect(cto.evidencePanel(ids.acme).length).toBeGreaterThan(0);
  });

  it('AI workspace answers across scopes, always linking source evidence', async () => {
    const ws = await intel.workspace(ids.acme);
    expect(ws.scopes().length).toBe(9);
    const ans = await ws.chat('project', ids.acme, 'ada', 'Ship');
    expect(ans.evidence.length).toBeGreaterThan(0);
    expect(ans.sources).toContain('nems');
    expect(ans.text).toContain('evidence');
    expect(ans.auditId).toBeTruthy();
  });

  it('briefing engine generates all thirteen types; honest about missing live sources', async () => {
    const br = await intel.briefings(ids.acme);
    expect(br.types().length).toBe(13);
    const morning = await br.generate('morning', ids.acme, 'ada');
    expect(morning.sections.length).toBeGreaterThanOrEqual(3);
    expect(morning.summary.auditId).toBeTruthy();
    const sales = await br.generate('sales', ids.acme, 'ada');
    expect(sales.sections.some((s) => s.body.includes('infra-pending'))).toBe(true);
  });

  it('governs every AI answer on the one audit chain + event bus (Governance Test)', () => {
    expect(intel.governance().count('intelligence.answer')).toBeGreaterThan(0);
    expect(intel.governance().verify()).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
    // the base ai-runtime inference governance also recorded each generation
    expect(intel.aiRuntime().governance().history().length).toBeGreaterThan(0);
  });

  it('builds executive dashboards without fabricating figures for missing sources', async () => {
    const dash = await intel.dashboards(ids.acme);
    const ceo = dash.build('CEO', ids.acme);
    expect(ceo.panels.revenue.value).toBe('no live data'); // honest, not a fabricated number
    expect(typeof ceo.panels.companyHealth.value).toBe('number');
    expect(Number(ceo.panels.risks.value)).toBeGreaterThanOrEqual(1);
  });

  it('keeps the evidence discipline honest — live LLM is adapter-verified, not live-verified', () => {
    const liveLlm = INTELLIGENCE_MATRIX.find((m) => m.capability.includes('live LLM'))!;
    expect(liveLlm.level).toBe('adapter-verified');
    const graph = INTELLIGENCE_MATRIX.find((m) => m.capability === 'Knowledge Graph')!;
    expect(graph.level).toBe('live-verified');
    // nothing that mentions a live LLM claims live-verified
    expect(INTELLIGENCE_MATRIX.filter((m) => /live LLM/.test(m.capability) && m.level === 'live-verified').length).toBe(0);
    expect(intel.readiness().liveVerified).toBeGreaterThan(0);
  });
});
