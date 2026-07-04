import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Briefing, FounderFinding } from '@neuropause/shared';

// Mock the data-read dependencies so the source is unit-testable without a live store.
const mockFindings = vi.fn<[], FounderFinding[]>();
const mockBriefing = vi.fn<[], Briefing>();

vi.mock('../unified/storeInstance', () => ({
  unifiedStore: { query: () => ({ items: [] }) },
}));
vi.mock('../timeline', () => ({
  getEnterpriseTimeline: () => ({ query: () => ({ entries: [] }) }),
}));
vi.mock('../intelligence/briefingGenerator', () => ({
  generateBriefing: () => mockBriefing(),
}));
vi.mock('./founderAI', () => ({
  founderFindingsFromBriefing: () => mockFindings(),
}));

import { buildFounderProactiveItems, founderProactiveSource } from './founderProactive';

function briefingWithSections(titles: Array<{ id: string; title: string }>): Briefing {
  return {
    period: 'morning',
    generatedAt: new Date().toISOString(),
    sections: titles.map((t) => ({
      id: t.id,
      title: t.title,
      empty: false,
      items: [],
    })),
  } as unknown as Briefing;
}

function finding(
  label: string,
  text: string,
  evidenceCount: number,
  connectorId: string | null = null,
): FounderFinding {
  return {
    label,
    text,
    at: new Date().toISOString(),
    connectorId,
    evidence: Array.from({ length: evidenceCount }, (_, i) => ({ kind: 'commit', id: `c${i}` })),
  } as FounderFinding;
}

describe('Founder AI proactive intelligence', () => {
  beforeEach(() => {
    mockFindings.mockReset();
    mockBriefing.mockReset();
  });

  it('produces nothing when there are no findings (silent no-op)', () => {
    mockBriefing.mockReturnValue(briefingWithSections([]));
    mockFindings.mockReturnValue([]);
    expect(buildFounderProactiveItems('morning')).toEqual([]);
  });

  it('maps an engineering_risk finding to a critical, governance-complete item', () => {
    mockBriefing.mockReturnValue(
      briefingWithSections([{ id: 'engineering_risk', title: 'Engineering risk' }]),
    );
    mockFindings.mockReturnValue([
      finding('Engineering risk', 'Build failing on main', 2, 'github'),
    ]);

    const [item] = buildFounderProactiveItems('morning');
    expect(item.priority).toBe('critical');
    expect(item.title).toContain('Founder AI');
    expect(item.body).toBe('Build failing on main');
    // Governance (STEP 5): evidence, sources, confidence, reasoning, action all present.
    expect(item.governance).toBeDefined();
    expect(item.governance!.evidence).toEqual(['commit:c0', 'commit:c1']);
    expect(item.governance!.sourceSystems).toContain('github');
    expect(item.governance!.confidence).toBeCloseTo(0.75, 5); // 2 evidence => 0.75
    expect(item.governance!.reasoning).toBeTruthy();
    expect(item.governance!.recommendedAction).toBeTruthy();
    expect(item.deepLink).toBe('ai-workforce/founder');
  });

  it('scales confidence with evidence count', () => {
    mockBriefing.mockReturnValue(briefingWithSections([{ id: 'pr_health', title: 'PR health' }]));
    mockFindings.mockReturnValue([finding('PR health', 'stale PR', 3)]);
    const [item] = buildFounderProactiveItems('morning');
    expect(item.governance!.confidence).toBeCloseTo(0.9, 5); // 3+ => 0.9
  });

  it('falls back to a normal-priority default for unknown sections', () => {
    mockBriefing.mockReturnValue(briefingWithSections([{ id: 'documents', title: 'Documents' }]));
    mockFindings.mockReturnValue([finding('Documents', 'doc updated', 1)]);
    const [item] = buildFounderProactiveItems('morning');
    expect(item.priority).toBe('normal');
    expect(item.governance!.confidence).toBeCloseTo(0.6, 5); // 1 evidence => 0.6
  });

  it('exposes a daily source at the configured minute', () => {
    const src = founderProactiveSource(8 * 60);
    expect(src.key).toBe('founder-ai-proactive');
    expect(src.cadence).toEqual({ kind: 'daily', atMinutes: 480 });
  });
});
