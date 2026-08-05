import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createDeploymentOrchestrator } from './platform';

describe('E6 / E7 / E8 — customer success + commercial ops + partner ecosystem', () => {
  it('runs the commercial pipeline without ever signing a contract or claiming revenue', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });

    const opp = await orch.commercial().createOpportunity({ organization: 'Acme', estimatedValue: 120000 });
    await orch.commercial().createQuote({ opportunityId: opp.id, amount: 100000 });
    const contract = await orch.commercial().recordContract(opp.id);
    expect(contract.signed).toBe(false); // never signed

    const license = await orch.commercial().activateLicense({ organization: 'Acme', plan: 'enterprise' });
    expect(license.backedByContract).toBe(false);

    const pipeline = orch.commercial().pipelineValue();
    expect(pipeline.representedValue).toBe(120000);
    expect(pipeline.isRevenue).toBe(false); // pipeline value is NOT revenue
  });

  it('represents partners until agreements exist', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });
    const partner = await orch.partners().registerPartner({ name: 'Globex SI', type: 'system-integrator' });
    expect(partner.agreementSigned).toBe(false);
    expect(orch.partners().listByType('system-integrator')).toHaveLength(1);
  });

  it('computes customer health from supplied signals but has no production adoption data', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const orch = createDeploymentOrchestrator(rt, { clock });
    const account = await orch.customerSuccess().registerAccount({ organization: 'Acme' });
    const updated = await orch.customerSuccess().recordHealth({ accountId: account.id, signals: [{ label: 'logins', value: 80 }, { label: 'nps', value: 60 }] });
    expect(updated.healthScore).toBe(70); // real average of supplied signals
    const renewal = await orch.customerSuccess().planRenewal({ accountId: account.id, termMonths: 12 });
    expect(renewal.committed).toBe(false);
    expect(orch.customerSuccess().productionAdoption().measured).toBe(false); // honest
  });
});
