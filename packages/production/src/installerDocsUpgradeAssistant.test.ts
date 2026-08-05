import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createProductionPlatform } from './platform';

describe('M15–M17 — upgrade assistant, installer, documentation', () => {
  it('the upgrade assistant flags a real breaking (major) version change', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const minor = await prod.upgradeAssistant().analyze({ fromVersion: '1.0.0', toVersion: '1.4.0' });
    expect(minor.breakingChange).toBe(false);
    const major = await prod.upgradeAssistant().analyze({ fromVersion: '1.9.0', toVersion: '2.0.0', dependencies: [{ name: 'libx', satisfied: false }] });
    expect(major.breakingChange).toBe(true);
    expect(major.dependencyIssues).toEqual(['libx']);
  });

  it('installers are represented, not built here', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const k8s = await prod.installer().generate({ target: 'kubernetes', version: '1.0.0' });
    expect(k8s.built).toBe(false);
    expect(k8s.artifactName).toBe('nems-1.0.0-helm.tgz');
    const win = await prod.installer().generate({ target: 'windows', version: '1.0.0' });
    expect(win.artifactName).toBe('nems-1.0.0-setup.exe');
  });

  it('documentation generates real structured guide outlines', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    const dr = await prod.documentation().generate({ kind: 'disaster-recovery' });
    expect(dr.title).toBe('Disaster Recovery Guide');
    expect(dr.sections.length).toBeGreaterThan(0);
    expect(prod.documentation().count()).toBe(1);
  });
});
