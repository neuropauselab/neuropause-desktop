import { describe, expect, it } from 'vitest';
import {
  entraDeltaRequestUrl,
  entraAdvanceCursor,
  isGraphRemoved,
  splitGraphDelta,
  graphUserFields,
  graphGroupFields,
  tenantFromOrganization,
  validateIntegrationProfile,
  ENTRA_INTEGRATION_PROFILE,
  ENTRA_GRAPH_SCOPES,
  GRAPH_BASE_URL,
  GRAPH_API_VERSION,
  type GraphUser,
  type GraphOrganization,
  type GraphDeltaResponse,
} from '@neuropause/shared';

describe('entraGraph — delta cursor', () => {
  it('picks the request URL: next > delta > base', () => {
    expect(entraDeltaRequestUrl(null, 'BASE')).toBe('BASE');
    expect(entraDeltaRequestUrl({ delta: 'DELTA' }, 'BASE')).toBe('DELTA');
    expect(entraDeltaRequestUrl({ next: 'NEXT', delta: 'DELTA' }, 'BASE')).toBe('NEXT');
  });

  it('advances on nextLink (more) then deltaLink (done), keeping prev delta when absent', () => {
    expect(entraAdvanceCursor({ '@odata.nextLink': 'N' }, null)).toEqual({ cursor: { next: 'N' }, hasMore: true });
    expect(entraAdvanceCursor({ '@odata.deltaLink': 'D' }, null)).toEqual({ cursor: { delta: 'D' }, hasMore: false });
    expect(entraAdvanceCursor({}, 'PREV')).toEqual({ cursor: { delta: 'PREV' }, hasMore: false });
  });
});

describe('entraGraph — delta split', () => {
  it('partitions present vs removed', () => {
    const resp: GraphDeltaResponse<GraphUser> = {
      value: [
        { id: 'u1', displayName: 'A' },
        { id: 'u2', '@removed': { reason: 'deleted' } },
        { id: 'u3', displayName: 'C' },
      ],
    };
    const { present, removedIds } = splitGraphDelta(resp);
    expect(present.map((u) => u.id)).toEqual(['u1', 'u3']);
    expect(removedIds).toEqual(['u2']);
    expect(isGraphRemoved({ '@removed': {} })).toBe(true);
    expect(isGraphRemoved({})).toBe(false);
  });
});

describe('entraGraph — field extractors (flat, primitive metadata)', () => {
  it('flattens a user', () => {
    const u: GraphUser = {
      id: 'u1',
      displayName: 'Ada Lovelace',
      userPrincipalName: 'ada@contoso.com',
      mail: 'ada@contoso.com',
      jobTitle: 'Engineer',
      department: 'R&D',
      accountEnabled: true,
      userType: 'Member',
    };
    const f = graphUserFields(u);
    expect(f.title).toBe('Ada Lovelace');
    expect(f.email).toBe('ada@contoso.com');
    expect(f.enabled).toBe(true);
    expect(f.metadata.directoryType).toBe('user');
    expect(f.metadata.userType).toBe('member');
    for (const v of Object.values(f.metadata)) {
      expect(v === null || ['string', 'number', 'boolean'].includes(typeof v)).toBe(true);
    }
  });

  it('falls back to UPN for title and reflects disabled/default-enabled', () => {
    expect(graphUserFields({ id: 'u9', accountEnabled: false, userPrincipalName: 'x@y.com' }).title).toBe('x@y.com');
    expect(graphUserFields({ id: 'u9', accountEnabled: false }).enabled).toBe(false);
    expect(graphUserFields({ id: 'u9' }).enabled).toBe(true);
  });

  it('classifies group class', () => {
    expect(graphGroupFields({ id: 'g1', displayName: 'Eng', groupTypes: ['Unified'] }).metadata.groupClass).toBe('microsoft365');
    expect(graphGroupFields({ id: 'g2', displayName: 'Sec', securityEnabled: true }).metadata.groupClass).toBe('security');
    expect(graphGroupFields({ id: 'g3', displayName: 'Dist' }).metadata.groupClass).toBe('distribution');
  });

  it('extracts tenant identity from the organization', () => {
    const org: GraphOrganization = {
      id: 'tid-1',
      displayName: 'Contoso',
      verifiedDomains: [
        { name: 'contoso.onmicrosoft.com', isInitial: true },
        { name: 'contoso.com', isDefault: true },
      ],
    };
    const t = tenantFromOrganization(org);
    expect(t.tenantId).toBe('tid-1');
    expect(t.name).toBe('Contoso');
    expect(t.defaultDomain).toBe('contoso.com');
    expect(t.verifiedDomainCount).toBe(2);
  });
});

describe('entraGraph — endpoints, scopes, and P2.1 profile', () => {
  it('exposes the real Graph endpoints + directory scopes', () => {
    expect(GRAPH_BASE_URL).toBe('https://graph.microsoft.com/v1.0');
    expect(GRAPH_API_VERSION).toBe('v1.0');
    expect(ENTRA_GRAPH_SCOPES).toContain('offline_access');
    expect(ENTRA_GRAPH_SCOPES).toContain('User.Read.All');
    expect(ENTRA_GRAPH_SCOPES).toContain('Directory.Read.All');
  });

  it('the Entra integration profile is valid per the P2.1 foundation', () => {
    expect(validateIntegrationProfile(ENTRA_INTEGRATION_PROFILE)).toEqual({ ok: true, errors: [] });
    expect(ENTRA_INTEGRATION_PROFILE.connectorId).toBe('microsoft-entra');
    expect(ENTRA_INTEGRATION_PROFILE.authKinds).toContain('oauth2_confidential');
    expect(ENTRA_INTEGRATION_PROFILE.supportedObjects.map((o) => o.id)).toEqual(['users', 'groups', 'organization']);
  });
});
