import { describe, expect, it } from 'vitest';
import type { Organization, OrgUnit, OrgUser } from '@neuropause/shared';
import { buildOrgGraph, orgGraphNeighbors, type EntityRef, type ConnectorRef } from './orgGraph';

const NOW = '2026-02-10T00:00:00.000Z';

const org: Organization = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  description: 'Test org',
  createdAt: NOW,
  updatedAt: NOW,
  metadata: {},
};

const units: OrgUnit[] = [
  { id: 'bu', orgId: 'org-1', kind: 'business_unit', name: 'Engineering', parentId: null, leadUserId: 'u1', createdAt: NOW, updatedAt: NOW },
  { id: 'team', orgId: 'org-1', kind: 'team', name: 'Platform', parentId: 'bu', leadUserId: null, createdAt: NOW, updatedAt: NOW },
];

const users: OrgUser[] = [
  { id: 'u1', orgId: 'org-1', name: 'Lead', email: null, title: 'Lead', kind: 'human', workerId: null, unitId: 'bu', roleIds: [], status: 'active', createdAt: NOW, updatedAt: NOW },
  { id: 'u2', orgId: 'org-1', name: 'Eng AI', email: null, title: 'Engineering AI', kind: 'ai_worker', workerId: 'w1', unitId: 'team', roleIds: [], status: 'active', createdAt: NOW, updatedAt: NOW },
];

const entities: EntityRef[] = [
  { id: 'p1', kind: 'project', title: 'Project One', connectorId: 'c1' },
  { id: 'd1', kind: 'document', title: 'Doc One', connectorId: 'c1' },
  { id: 'cust1', kind: 'customer', title: 'Customer One', connectorId: 'c1' },
];

const connectors: ConnectorRef[] = [{ id: 'c1', name: 'Slack' }];

describe('buildOrgGraph', () => {
  it('projects org, units, members, connectors, and entities into one graph', () => {
    const g = buildOrgGraph({ org, units, users, entities, connectors, now: NOW });

    expect(g.nodes.find((n) => n.kind === 'organization')?.label).toBe('Acme');
    expect(g.counts.byNodeKind.unit).toBe(2);
    expect(g.counts.byNodeKind.user).toBe(1); // human
    expect(g.counts.byNodeKind.worker).toBe(1); // ai_worker
    expect(g.counts.byNodeKind.connector).toBe(1);
    expect(g.counts.byNodeKind.project).toBe(1);
    expect(g.counts.byNodeKind.document).toBe(1);
    expect(g.counts.byNodeKind.customer).toBe(1);
  });

  it('builds the expected relationship edges', () => {
    const g = buildOrgGraph({ org, units, users, entities, connectors, now: NOW });
    const kinds = new Set(g.edges.map((e) => e.kind));
    expect(kinds.has('contains')).toBe(true); // org → bu, bu → team
    expect(kinds.has('member_of')).toBe(true); // user → unit
    expect(kinds.has('leads')).toBe(true); // u1 leads bu
    expect(kinds.has('operates')).toBe(true); // worker → org
    expect(kinds.has('connected')).toBe(true); // org → connector
    expect(kinds.has('owns')).toBe(true); // org → project
    expect(kinds.has('engages')).toBe(true); // org → customer
    expect(kinds.has('authored')).toBe(true); // org → document
  });

  it('caps business entities per kind', () => {
    const many: EntityRef[] = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, kind: 'project', title: `P${i}`, connectorId: null }));
    const g = buildOrgGraph({ org, units, users, entities: many, connectors, entityCap: 5, now: NOW });
    expect(g.counts.byNodeKind.project).toBe(5);
  });

  it('returns neighbors of a node', () => {
    const g = buildOrgGraph({ org, units, users, entities, connectors, now: NOW });
    const n = orgGraphNeighbors(g, 'org:org-1');
    expect(n).not.toBeNull();
    expect(n!.neighbors.length).toBeGreaterThan(0);
    expect(orgGraphNeighbors(g, 'missing')).toBeNull();
  });
});
