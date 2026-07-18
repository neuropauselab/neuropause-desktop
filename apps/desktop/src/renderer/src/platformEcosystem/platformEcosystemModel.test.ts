import { describe, it, expect } from 'vitest';
import { type OpLens } from '@renderer/aiOperations/aiOperationsModel';
import { ECO_AREAS, ecosystemAreas, type EcoTab } from './platformEcosystemModel';

const lensWith = (stat: OpLens['stats'][number], gaps = 0): OpLens => ({
  stats: [stat],
  groups: [],
  gaps: Array.from({ length: gaps }, (_, i) => ({ capability: `g${i}`, requires: 'x' })),
  links: [],
});

describe('ecosystemAreas', () => {
  it('emits one area per ECO_AREAS entry, in order', () => {
    const areas = ecosystemAreas({});
    expect(areas).toHaveLength(ECO_AREAS.length);
    expect(areas.map((a) => a.key)).toEqual(ECO_AREAS.map((a) => a.key));
  });

  it('uses the first stat as headline and counts gaps', () => {
    const lenses: Partial<Record<EcoTab, OpLens>> = {
      connectors: lensWith({ icon: 'connectors', label: 'Connectors', value: '22', tone: 'green' }, 3),
    };
    const con = ecosystemAreas(lenses).find((a) => a.key === 'connectors')!;
    expect(con.headline).toBe('Connectors: 22');
    expect(con.gaps).toBe(3);
    expect(con.tone).toBe('green');
  });

  it('shows an honest empty headline and gray tone when a lens is absent', () => {
    const partners = ecosystemAreas({}).find((a) => a.key === 'partners')!;
    expect(partners.headline).toBe('No live data yet');
    expect(partners.tone).toBe('gray');
    expect(partners.gaps).toBe(0);
  });
});
