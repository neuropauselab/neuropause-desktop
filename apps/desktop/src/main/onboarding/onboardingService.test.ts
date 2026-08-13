import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS } from '@neuropause/shared';
import { createOnboardingService, type OnboardingService } from './onboardingService';

const T0 = new Date('2026-07-01T00:00:00.000Z');

describe('createOnboardingService', () => {
  let filePath: string;
  let clock: Date;
  let svc: OnboardingService;

  beforeEach(async () => {
    filePath = join(tmpdir(), `nps-onboarding-${randomUUID()}.json`);
    clock = T0;
    svc = createOnboardingService({ filePath, now: () => clock });
    await svc.load();
  });
  afterEach(async () => {
    await fs.rm(filePath, { force: true });
    await fs.rm(`${filePath}.tmp`, { force: true });
  });

  it('starts as a first run with the full step catalog and welcome next', () => {
    const s = svc.getStatus();
    expect(s.firstRun).toBe(true);
    expect(s.startedAt).toBeNull();
    expect(s.completedAt).toBeNull();
    expect(s.steps).toHaveLength(ONBOARDING_STEPS.length);
    expect(s.steps.every((st) => st.completedAt === null)).toBe(true);
    expect(s.nextStep).toBe('welcome');
  });

  it('start stamps startedAt once and ends first-run (idempotent)', async () => {
    const first = await svc.start();
    expect(first.firstRun).toBe(false);
    expect(first.startedAt).toBe(T0.toISOString());
    clock = new Date(T0.getTime() + 60_000);
    const again = await svc.start();
    expect(again.startedAt).toBe(T0.toISOString());
  });

  it('completeStep marks the step, auto-starts, and advances nextStep', async () => {
    const s = await svc.completeStep('welcome');
    expect(s.startedAt).toBe(T0.toISOString());
    expect(s.steps.find((st) => st.id === 'welcome')?.completedAt).toBe(T0.toISOString());
    // Phase 8 (8.13): the legal step follows welcome in the catalog.
    expect(s.nextStep).toBe('legal');
    expect(s.completedAt).toBeNull();
  });

  it('completeStep is idempotent and preserves the original timestamp', async () => {
    await svc.completeStep('welcome');
    clock = new Date(T0.getTime() + 60_000);
    const s = await svc.completeStep('welcome');
    expect(s.steps.find((st) => st.id === 'welcome')?.completedAt).toBe(T0.toISOString());
  });

  it('completing every step finishes onboarding', async () => {
    for (const step of ONBOARDING_STEPS) {
      clock = new Date(clock.getTime() + 1_000);
      await svc.completeStep(step.id);
    }
    const s = svc.getStatus();
    expect(s.completedAt).not.toBeNull();
    expect(s.nextStep).toBeNull();
    expect(s.firstRun).toBe(false);
  });

  it('dismiss ends the wizard but leaves steps individually incomplete', async () => {
    await svc.completeStep('welcome');
    const s = await svc.dismiss();
    expect(s.completedAt).toBe(T0.toISOString());
    expect(s.firstRun).toBe(false);
    // Phase 8 (8.13): the legal step follows welcome in the catalog.
    expect(s.nextStep).toBe('legal');
    expect(s.steps.filter((st) => st.completedAt === null)).toHaveLength(
      ONBOARDING_STEPS.length - 1,
    );
  });

  it('persists across a reload', async () => {
    await svc.completeStep('welcome');
    await svc.completeStep('organization');
    const reloaded = createOnboardingService({ filePath, now: () => clock });
    await reloaded.load();
    const s = reloaded.getStatus();
    expect(s.startedAt).toBe(T0.toISOString());
    // Phase 8 (8.13): with legal inserted after welcome, it is the first incomplete step here.
    expect(s.nextStep).toBe('legal');
    expect(s.steps.filter((st) => st.completedAt !== null)).toHaveLength(2);
  });

  it('reset returns the install to a first run', async () => {
    await svc.completeStep('welcome');
    await svc.dismiss();
    const s = await svc.reset();
    expect(s).toMatchObject({ firstRun: true, startedAt: null, completedAt: null });
    expect(s.nextStep).toBe('welcome');
  });
});
