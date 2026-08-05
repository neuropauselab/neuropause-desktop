import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform, type BusinessPlatform } from './platform';

describe('Modules 12,13,14,15 — Healthcare, HR, Projects, Assets', () => {
  let runtime: EnterpriseRuntime;
  let biz: BusinessPlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    biz = createBusinessPlatform(runtime, { clock });
  });

  it('healthcare uses SYNTHETIC FHIR models — never real patient data', async () => {
    const prov = await biz.healthcare().registerProvider({ name: 'Dr. Rivera', specialty: 'cardiology' });
    const pat = await biz.healthcare().createPatientModel('Synthetic Patient A');
    expect(pat.synthetic).toBe(true);
    expect(pat.note).toMatch(/no real patient data/i);
    expect(biz.healthcare().fhirResource('Patient', { resourceType: 'Patient', id: 'x' }).valid).toBe(true);
    expect(biz.healthcare().fhirResource('Patient', { resourceType: 'Observation' }).valid).toBe(false);
    expect(prov.specialty).toBe('cardiology');
  });

  it('builds an HR org chart from real manager relationships', async () => {
    const mgr = await biz.hr().createEmployee({ name: 'Grace Hopper', title: 'VP' });
    await biz.hr().createEmployee({ name: 'Alan Turing', title: 'Engineer', managerId: mgr.id });
    const chart = biz.hr().orgChart();
    expect(chart.find((c) => c.id === mgr.id)!.reports).toBe(1);
    expect(biz.hr().count()).toBe(2);
  });

  it('manages projects with tasks, capacity, and OKRs', async () => {
    const proj = await biz.projects().createProject({ name: 'Launch' });
    await biz.projects().addTask({ projectId: proj.id, name: 'design', assignee: 'ada', estimateHours: 20 });
    await biz.projects().addTask({ projectId: proj.id, name: 'build', assignee: 'ada', estimateHours: 30 });
    expect(biz.projects().capacity('ada').committedHours).toBe(50);
    await biz.projects().defineOKR({ objective: 'Ship v1', keyResults: ['Beta by Q2', 'NPS > 40'] });
    expect(biz.projects().okrs().length).toBe(1);
  });

  it('registers assets by category', async () => {
    await biz.assets().registerAsset({ name: 'Laptop', category: 'hardware' });
    await biz.assets().registerAsset({ name: 'Office Suite', category: 'license' });
    expect(biz.assets().byCategory()['hardware']).toBe(1);
    expect(biz.assets().count()).toBe(2);
  });
});
