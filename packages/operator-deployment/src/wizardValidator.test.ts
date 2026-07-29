import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createOperatorDeployment } from './platform';
import type { WizardConfig } from './types';

const FULL: WizardConfig = {
  cloudProvider: 'aws',
  region: 'us-east-1',
  domain: 'api.acme.com',
  kubernetesRef: 'eks:acme',
  postgresqlRef: 'rds:acme',
  redisRef: 'elasticache:acme',
  objectStorageRef: 's3:acme',
  containerRegistryRef: 'ecr:acme',
  secretsManagerRef: 'aws-secrets-manager',
};

describe('items 1-2 — deployment wizard + environment validator', () => {
  it('wizard reports missing fields and completes when all are present', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const od = createOperatorDeployment(rt, { clock });

    const empty = await od.wizard().collect({});
    expect(empty.complete).toBe(false);
    expect(empty.missing).toContain('cloudProvider');
    expect(empty.missing).toContain('secretsManager');

    const full = await od.wizard().collect(FULL);
    expect(full.complete).toBe(true);
    expect(full.missing).toHaveLength(0);
    const inputs = od.wizard().toOperatorInputs(FULL);
    expect(inputs.cloudProvider).toBe('aws');
    expect(inputs.containerRegistryRef).toBe('ecr:acme');
  });

  it('validator STOPS at PENDING - OPERATOR ACTION REQUIRED (no reachability fabricated)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const od = createOperatorDeployment(rt, { clock });
    const result = await od.validator().validate(FULL);
    expect(result.ready).toBe(false);
    expect(result.status).toBe('PENDING - OPERATOR ACTION REQUIRED');
    expect(result.checks).toHaveLength(6);
    expect(result.checks.every((c) => c.verified === false)).toBe(true);
  });
});
