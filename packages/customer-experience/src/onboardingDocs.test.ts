import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createReleasePlatform } from '@neuropause/release';
import { createWorkplacePlatform } from '@neuropause/workplace';
import { createCustomerExperience } from './platform';
import { ONBOARDING_STEPS } from './constants';

describe('E7 / E8 — onboarding wizard + documentation center', () => {
  it('marks onboarding complete ONLY when every step is done — never fabricated', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const workplace = createWorkplacePlatform(rt, { clock });
    const cx = createCustomerExperience(rt, { clock, workplace });

    const wizard = await cx.onboarding().start({ organization: 'acme' });
    expect(wizard.reusedWorkplace).toBe(true);
    expect(cx.onboarding().checklist(wizard.id).allComplete).toBe(false);

    for (const step of ONBOARDING_STEPS.slice(0, ONBOARDING_STEPS.length - 1)) {
      await cx.onboarding().completeStep(wizard.id, step);
    }
    expect(cx.onboarding().checklist(wizard.id).allComplete).toBe(false); // one step remains

    await cx.onboarding().completeStep(wizard.id, ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]!);
    const done = cx.onboarding().checklist(wizard.id);
    expect(done.allComplete).toBe(true);
    expect(done.remaining).toHaveLength(0);
  });

  it('generates documentation items and REUSES the release documentation generator', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const release = createReleasePlatform(rt, { clock });
    const cx = createCustomerExperience(rt, { clock, release });

    expect(cx.documentation().items().length).toBe(7);
    expect((await cx.documentation().generate('user-guide')).reusedRelease).toBe(true);
    expect((await cx.documentation().generate('faq')).reusedRelease).toBe(false);
  });
});
