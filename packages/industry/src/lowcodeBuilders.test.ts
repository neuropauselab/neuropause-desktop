import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createIndustryPlatform, type IndustryPlatform } from './platform';

describe('Low-Code Platform — seven builders', () => {
  let runtime: EnterpriseRuntime;
  let ind: IndustryPlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    ind = createIndustryPlatform(runtime, { clock });
  });

  it('produces object / form / workflow / report / dashboard / automation / document definitions', async () => {
    const lc = ind.lowcode();
    await lc.buildObject({ name: 'Ticket', fields: [{ name: 'subject', type: 'text' }], reusesDomain: 'projects' });
    await lc.buildForm({ name: 'TicketForm', objectName: 'Ticket', fields: ['subject'] });
    await lc.buildWorkflow({ name: 'TicketFlow', steps: ['open', 'resolve'], requiresApproval: false });
    await lc.buildReport({ name: 'TicketReport', source: 'Ticket', columns: ['subject'] });
    await lc.buildDashboard({ name: 'TicketDash', widgets: ['open-count'] });
    await lc.buildAutomation({ name: 'AutoClose', triggers: ['resolved'] });
    await lc.buildDocument({ name: 'TicketPdf', format: 'pdf', sections: ['summary'] });
    expect(lc.count()).toBe(7);
    expect(lc.objects()[0]!.name).toBe('Ticket');
    expect(lc.workflows()[0]!.steps).toEqual(['open', 'resolve']);
  });

  it('rejects an object without fields and a workflow without steps', async () => {
    await expect(ind.lowcode().buildObject({ name: 'Empty', fields: [], reusesDomain: 'crm' })).rejects.toThrow();
    await expect(ind.lowcode().buildWorkflow({ name: 'NoSteps', steps: [], requiresApproval: false })).rejects.toThrow();
  });
});
