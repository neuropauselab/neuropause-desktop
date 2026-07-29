import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createReliabilityPlatform } from '@neuropause/reliability';
import { createOperationsPlatform } from '@neuropause/operations';
import { createPlatformOperations } from './platform';
import { PLATFORM_OPS_MATRIX, platformOpsReadiness, EXPECTED_ADAPTERS, EXPECTED_INFRA_PENDING } from './evidence';
import { TARGET_DOMAIN } from './constants';

// External providers, real data, or real infrastructure — must NEVER be classified live.
const ADAPTER_OR_DATA = /AWS|Azure|Google Cloud|PostgreSQL|Redis|Qdrant|AI providers|Monitoring stack|Vault|CDN|WAF|Real production|customer sessions|AI usage|database query load|Live domain|Running Kubernetes|Provisioned production|Issued TLS|load balancers|object storage/;

describe('E16 / E17 / E18 + evidence — docs, dashboard, governance, honesty invariant', () => {
  it('audits every production operation on the ONE chain with a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createPlatformOperations(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'platform-ops.action', (e) => { events.push(e.payload as Record<string, unknown>); });
    await ops.cloud().registerEnvironment({ provider: 'aws', tier: 'production', region: 'us-east-1' });
    expect(ops.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['environment']).toBe('production');
  });

  it('generates seven operations manuals (reusing reliability docs) and an honest executive dashboard', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const reliability = createReliabilityPlatform(rt, { clock });
    const opsPlat = createOperationsPlatform(rt, { clock });
    const ops = createPlatformOperations(rt, { clock, reliability, operations: opsPlat });

    expect(ops.documentation().manualKinds().length).toBe(7);
    expect((await ops.documentation().generate('recovery')).reusedReliability).toBe(true);
    expect((await ops.documentation().generate('kubernetes')).reusedReliability).toBe(false);

    const tiles = ops.executiveDashboard().snapshot();
    const platform = tiles.find((t) => t.tile === 'platform-status')!;
    expect(platform.live).toBe(false); // the domain is not live
    expect(platform.value).toContain(TARGET_DOMAIN);
    expect(tiles.find((t) => t.tile === 'infrastructure-status')!.value).toBe('infrastructure-pending');
  });

  it('NEVER promotes evidence incorrectly — the domain, clusters, and databases are infrastructure-pending', () => {
    const nonLiveClassifiedLive = PLATFORM_OPS_MATRIX.filter((m) => m.level === 'live-verified' && ADAPTER_OR_DATA.test(m.capability));
    expect(nonLiveClassifiedLive).toHaveLength(0);

    const level = (cap: string): string | undefined => PLATFORM_OPS_MATRIX.find((m) => m.capability.startsWith(cap))?.level;
    expect(level('Live domain')).toBe('infrastructure-pending');
    expect(level('Running Kubernetes clusters')).toBe('infrastructure-pending');
    expect(level('Provisioned production databases')).toBe('infrastructure-pending');
    expect(level('Issued TLS certificates')).toBe('infrastructure-pending');

    const r = platformOpsReadiness();
    expect(r.total).toBe(PLATFORM_OPS_MATRIX.length);
    expect(r.liveVerified).toBe(20);
    expect(r.adapterVerified).toBe(EXPECTED_ADAPTERS); // 10
    expect(r.businessDataPending).toBe(5);
    expect(r.infrastructurePending).toBe(EXPECTED_INFRA_PENDING); // 6
  });
});
