/**
 * Phase 6 Stage 3 — query planner tests. Locks the deterministic NL
 * understanding: dates, connectors, kinds, records, modules, people, phrases,
 * flags, routing, explain transparency — and that the planner only ever
 * narrows (unknown words stay in the retrieval text; nothing is invented).
 */
import { describe, expect, it } from 'vitest';
import { planSearch } from './queryPlanner';

// Fixed clock: Thursday 2026-07-30T12:00 local.
const NOW = new Date(2026, 6, 30, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const startOfToday = new Date(2026, 6, 30, 0, 0, 0).getTime();

const plan = (q: string) => planSearch(q, NOW);

describe('relative dates', () => {
  it('understands today (and possessives)', () => {
    const p = plan("find today's invoices");
    expect(p.since).toBe(startOfToday);
    expect(p.until).toBeNull();
    expect(p.explain.join(' ')).toContain('time: today');
  });
  it('understands yesterday as a closed range', () => {
    const p = plan('show yesterday design review');
    expect(p.since).toBe(startOfToday - DAY);
    expect(p.until).toBe(startOfToday - 1);
  });
  it('understands last week and strips it from the text', () => {
    const p = plan('the contract from last week');
    expect(p.since).toBe(startOfToday - 13 * DAY);
    expect(p.until).toBe(startOfToday - 6 * DAY);
    expect(p.text).not.toMatch(/last week/i);
  });
  it('takes only one time filter', () => {
    const p = plan('today yesterday report');
    expect(p.since).not.toBeNull();
    expect(p.explain.filter((e) => e.startsWith('time:')).length).toBe(1);
  });
  it('no date terms → no bounds', () => {
    const p = plan('kubernetes');
    expect(p.since).toBeNull();
    expect(p.until).toBeNull();
  });
});

describe('connectors + kinds', () => {
  it('routes "search gmail for the contract" to gmail connectors, keeps contract as subject', () => {
    const p = plan('search gmail for the contract from last week');
    expect(p.connectorIds).toEqual(expect.arrayContaining(['gmail']));
    expect(p.entityKinds).toEqual(expect.arrayContaining(['document']));
    expect(p.text.toLowerCase()).toContain('contract');
    expect(p.text.toLowerCase()).not.toContain('gmail');
    expect(p.sources).toContain('engine');
  });
  it('github issues → github connector + task kind', () => {
    const p = plan('show github issues assigned to me');
    expect(p.connectorIds).toContain('github');
    expect(p.entityKinds).toContain('task');
    expect(p.flags.mine).toBe(true);
  });
  it('pull requests (multi-word) map to task kind', () => {
    const p = plan('github pull requests');
    expect(p.entityKinds).toContain('task');
  });
  it('emails map to message kinds and are stripped from text', () => {
    const p = plan('unread finance emails');
    expect(p.entityKinds).toEqual(expect.arrayContaining(['message', 'conversation']));
    expect(p.flags.unread).toBe(true);
    expect(p.text.toLowerCase()).toContain('finance');
    expect(p.text.toLowerCase()).not.toContain('emails');
  });
  it('documents in google drive', () => {
    const p = plan('locate contracts from google drive');
    expect(p.connectorIds).toEqual(expect.arrayContaining(['google-drive']));
    expect(p.entityKinds).toEqual(expect.arrayContaining(['document', 'file']));
  });
  it('unknown words survive into the retrieval text', () => {
    const p = plan('neuropause roadmap');
    expect(p.text.toLowerCase()).toContain('neuropause');
    expect(p.text.toLowerCase()).toContain('roadmap');
    expect(p.connectorIds).toBeNull();
  });
});

describe('records + modules + engine hints', () => {
  it('decisions route to the decisions records feed', () => {
    const p = plan('show all enterprise decisions mentioning Finance');
    expect(p.recordKinds).toContain('decisions');
    expect(p.sources).toContain('records');
    expect(p.text.toLowerCase()).toContain('finance');
  });
  it('workflows using Slack routes records + slack connector', () => {
    const p = plan('find workflows using Slack');
    expect(p.recordKinds).toContain('workflows');
    expect(p.connectorIds).toContain('slack');
  });
  it('connectors with recent failures sets the failed flag', () => {
    const p = plan('show connectors with recent failures');
    expect(p.recordKinds).toContain('connectors');
    expect(p.flags.failed).toBe(true);
    expect(p.since).not.toBeNull(); // "recent"
  });
  it('AI sessions route to executions', () => {
    const p = plan('find AI sessions discussing Kubernetes');
    expect(p.recordKinds).toContain('executions');
    expect(p.text.toLowerCase()).toContain('kubernetes');
  });
  it('invoices route to the modules source and stay in the text', () => {
    const p = plan("today's invoices");
    expect(p.moduleTerms).toContain('invoice');
    expect(p.sources).toContain('modules');
    expect(p.text.toLowerCase()).toContain('invoice');
  });
  it('memory/timeline/graph hints narrow engine sources', () => {
    expect(plan('where did we discuss kubernetes in memory').engineSources).toContain('memory');
    expect(plan('timeline of deploys').engineSources).toContain('timeline');
    expect(plan('related entities graph for acme').engineSources).toContain('graph');
  });
});

describe('people, phrases, browse mode', () => {
  it('extracts a person from "involving John"', () => {
    const p = plan('find every project involving John');
    expect(p.person).toBe('John');
    expect(p.entityKinds).toContain('project');
    expect(p.text).toContain('John'); // the name stays searchable
  });
  it('two-word names are captured', () => {
    expect(plan('documents owned by Sam Rivera').person).toBe('Sam Rivera');
  });
  it('"assigned to me" sets the mine flag and explains the limitation', () => {
    const p = plan('tasks assigned to me');
    expect(p.flags.mine).toBe(true);
    expect(p.explain.join(' ')).toMatch(/later stage/i);
  });
  it('quoted phrases become exact-match post-filters and keep their words', () => {
    const p = plan('every document mentioning "NeuroPause"');
    expect(p.phrases).toEqual(['NeuroPause']);
    expect(p.text.toLowerCase()).toContain('neuropause');
  });
  it('record-only query with no residual text explains browse mode', () => {
    const p = plan('show decisions');
    expect(p.text).toBe('');
    expect(p.explain.join(' ')).toContain('browsing');
  });
});

describe('planner honesty + determinism', () => {
  it('never invents filters for plain text', () => {
    const p = plan('quarterly strategy narrative');
    expect(p.connectorIds).toBeNull();
    expect(p.entityKinds).toBeNull();
    expect(p.recordKinds).toBeNull();
    expect(p.moduleTerms).toEqual([]);
    expect(p.person).toBeNull();
  });
  it('is deterministic for the same input + clock', () => {
    const a = plan('search gmail for "the contract" from last week');
    const b = plan('search gmail for "the contract" from last week');
    expect(a).toEqual(b);
  });
  it('every extraction is explained', () => {
    const p = plan('github issues from last week involving John');
    const joined = p.explain.join(' | ');
    expect(joined).toContain('source: github');
    expect(joined).toContain('time: last week');
    expect(joined).toContain('person: John');
  });
  it('keeps raw verbatim', () => {
    const raw = '  Find yesterday’s design review  ';
    expect(planSearch(raw, NOW).raw).toBe(raw);
  });
});
