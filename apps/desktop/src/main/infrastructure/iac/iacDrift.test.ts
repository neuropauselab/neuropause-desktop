/**
 * P6.10 — the IaC DRIFT engine: desired-vs-actual classification (in_sync / drifted / changed / missing /
 * unmanaged), blast-radius impact REUSED from the Resource Graph, the deterministic risk matrix (destructive
 * change on a high-fan-in node → critical), and the drift score. Pure-node, read-only.
 */
import { describe, expect, it } from 'vitest';
import { makeResource, type CloudResource } from '@neuropause/shared';
import { computeDrift } from './iacDrift';
import type { ChangeSet, ResourceChange } from './iacPlan';

const NOW = '2026-07-14T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);

function mk(nativeId: string, opts: { attributes?: Record<string, string | number | boolean | null>; dependsOn?: string[] } = {}): CloudResource {
  return makeResource({
    platformId: 'iac', provider: 'iac', accountId: 'terraform', domain: 'provisioning', resourceType: 'iac_resource',
    nativeId, name: nativeId, now: NOW,
    attributes: opts.attributes,
    relationships: (opts.dependsOn ?? []).map((t) => ({ type: 'depends_on', targetId: t })),
  });
}
function change(address: string, action: ResourceChange['action'], extra: Partial<ResourceChange> = {}): ResourceChange {
  return { address, type: 'aws_x', provider: 'aws', action, replacePaths: [], changedKeys: [], fromDrift: false, dependsOn: [], ...extra };
}
function cs(changes: ResourceChange[]): ChangeSet {
  return { flavor: 'terraform', changes, counts: { create: 0, update: 0, delete: 0, replace: 0, drift: 0, 'no-op': 0, read: 0, total: changes.length }, applyOrder: [], destroyOrder: [], truncated: false, droppedCount: 0 };
}

describe('computeDrift', () => {
  // db has three transitive dependents → blast radius 3.
  const db = mk('db');
  const web = mk('web', { dependsOn: ['db'] });
  const app = mk('app', { dependsOn: ['db'] });
  const cache = mk('cache', { dependsOn: ['db'] });

  it('classifies a plan-changed high-fan-in node as changed + critical risk (destructive on blast≥3)', () => {
    const report = computeDrift({ desired: [db, web, app, cache], actual: [db, web, app, cache], changes: cs([change('db', 'replace', { replacePaths: ['engine'] })]) }, NOW_MS);
    const byAddr = Object.fromEntries(report.resources.map((r) => [r.address, r]));
    expect(byAddr['db'].status).toBe('changed');
    expect(byAddr['db'].impactScore).toBe(3); // reused blast radius
    expect(byAddr['db'].risk).toBe('critical');
    expect(byAddr['web'].status).toBe('in_sync');
    expect(byAddr['web'].risk).toBe('none');
    expect(report.counts).toMatchObject({ inSync: 3, changed: 1 });
    expect(report.driftScore).toBe(65); // round(100*3/4 - 10) = 65
    expect(report.topImpact[0].resourceId).toBe(byAddr['db'].resourceId);
  });

  it('detects out-of-band drift from a signature mismatch with no plan entry', () => {
    const desired = [mk('bucket', { attributes: { acl: 'private' } })];
    const actual = [mk('bucket', { attributes: { acl: 'public-read' } })];
    const report = computeDrift({ desired, actual }, NOW_MS);
    expect(report.resources[0].status).toBe('drifted');
    expect(report.resources[0].changedAttributes).toEqual(['acl']);
  });

  it('flags a resource_drift plan entry as drifted', () => {
    const r = mk('sg');
    const report = computeDrift({ desired: [r], actual: [r], changes: cs([change('sg', 'drift', { fromDrift: true })]) }, NOW_MS);
    expect(report.resources[0].status).toBe('drifted');
  });

  it('classifies desired-only as missing and actual-only as unmanaged', () => {
    const shared = mk('shared');
    const desiredOnly = mk('planned');
    const actualOnly = mk('orphan');
    const report = computeDrift({ desired: [shared, desiredOnly], actual: [shared, actualOnly], changes: cs([change('planned', 'create')]) }, NOW_MS);
    const byAddr = Object.fromEntries(report.resources.map((r) => [r.address, r]));
    expect(byAddr['planned'].status).toBe('missing');
    expect(byAddr['orphan'].status).toBe('unmanaged');
    expect(byAddr['shared'].status).toBe('in_sync');
  });

  it('is fully in sync (score 100) when desired equals actual with no changes', () => {
    const report = computeDrift({ desired: [db, web], actual: [db, web] }, NOW_MS);
    expect(report.driftScore).toBe(100);
    expect(report.counts.inSync).toBe(2);
    expect(report.builtAt).toBe(NOW);
  });
});
