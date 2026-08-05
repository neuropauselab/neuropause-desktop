/**
 * Phase 6 Stage 13 — the simulation inventory (G-4, simulation half).
 *
 * A register, not a simulator. The load-bearing assertion in this file is that
 * `invoked` is false STRUCTURALLY — not false because these particular fixtures
 * happen not to trigger anything. It is therefore checked across every input
 * combination the module accepts, including the ones that produce the largest
 * live readings, so that no reachable input makes it true.
 *
 * The second thing locked here is the zero/null distinction: `manufacturing-
 * what-if` has no main-process importer, so its live reading is null forever,
 * while a heuristic set that fires nothing reads zero — with a sentence saying
 * why zero is the honest answer rather than a missing one.
 *
 * Everything here is deterministic: fixtures are literals, no clock is read.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSimulationInventory,
  SIMULATION_DISCLOSURE,
  type SimulationInput,
} from './simulationInventory';
import { SIMULATION_REGISTRY } from './twinRegistry';

const NOW = '2026-08-01T09:00:00.000Z';

function mkInput(over: Partial<SimulationInput> = {}): SimulationInput {
  return {
    nowIso: NOW,
    predictions: [{ kind: 'approval-backlog' }, { kind: 'project-delay' }],
    scenarios: { count: 5 },
    forecasts: { registered: 3 },
    failures: {},
    ...over,
  };
}

/** Every combination of readable/unreadable inputs the module accepts. */
const ALL_INPUTS: SimulationInput[] = [
  mkInput(),
  mkInput({ predictions: null }),
  mkInput({ scenarios: null }),
  mkInput({ forecasts: null }),
  mkInput({ predictions: [] }),
  mkInput({ scenarios: { count: 0 }, forecasts: { registered: 0 } }),
  mkInput({ predictions: null, scenarios: null, forecasts: null }),
  mkInput({
    predictions: Array.from({ length: 99 }, () => ({ kind: 'risk-trend' })),
    scenarios: { count: 999 },
    forecasts: { registered: 999 },
  }),
];

describe('Stage 13 invokes nothing — structurally, not incidentally', () => {
  it('reports invoked:false on every entry, for every input the module accepts', () => {
    for (const [i, input] of ALL_INPUTS.entries()) {
      const inv = buildSimulationInventory(input);
      for (const entry of inv.entries) {
        expect(entry.invoked, `input#${i} ${entry.id}`).toBe(false);
      }
    }
  });

  it('holds invoked:false even when the live readings are at their largest', () => {
    const inv = buildSimulationInventory(ALL_INPUTS[ALL_INPUTS.length - 1]);
    expect(inv.totals.liveInstances).toBe(99 + 999 + 999);
    expect(inv.entries.every((e) => e.invoked === false)).toBe(true);
  });

  it('says so in the disclosure as well as in the data', () => {
    expect(SIMULATION_DISCLOSURE).toContain('invokes nothing');
    expect(SIMULATION_DISCLOSURE).toContain('by construction');
    expect(SIMULATION_DISCLOSURE).toContain('not that the count is zero');
  });
});

describe('the inventory registers what exists, verbatim', () => {
  it('emits one entry per registered capability, in registry order, carrying the declarations unchanged', () => {
    const inv = buildSimulationInventory(mkInput());
    expect(inv.entries).toHaveLength(4);
    expect(inv.entries.map((e) => e.id)).toEqual(SIMULATION_REGISTRY.map((s) => s.id));
    for (const def of SIMULATION_REGISTRY) {
      const entry = inv.entries.find((e) => e.id === def.id)!;
      expect(entry.label, def.id).toBe(def.label);
      expect(entry.kind, def.id).toBe(def.kind);
      expect(entry.module, def.id).toBe(def.module);
      expect(entry.scenarioCount, def.id).toBe(def.scenarioCount);
      expect(entry.canSimulate, def.id).toBe(def.canSimulate);
      expect(entry.cannotSimulate, def.id).toBe(def.cannotSimulate);
    }
  });

  it('counts the two capabilities that declare an authored scenario count', () => {
    const inv = buildSimulationInventory(mkInput());
    expect(inv.totals.registered).toBe(4);
    expect(inv.totals.withScenarios).toBe(2);
  });
});

describe('the manufacturing what-if is declared, never observed', () => {
  it('reports live:null on every input — it has no main-process importer to observe', () => {
    for (const [i, input] of ALL_INPUTS.entries()) {
      const entry = buildSimulationInventory(input).entries.find(
        (e) => e.id === 'manufacturing-what-if',
      )!;
      expect(entry.live, `input#${i}`).toBeNull();
    }
  });

  it('still carries its fifteen authored scenarios and says why nothing runs them', () => {
    const entry = buildSimulationInventory(mkInput()).entries.find(
      (e) => e.id === 'manufacturing-what-if',
    )!;
    expect(entry.scenarioCount).toBe(15);
    expect(entry.cannotSimulate).toContain('No main-process code imports it');
  });
});

describe('the heuristic entry distinguishes “nothing is firing” from “nothing is readable”', () => {
  it('reads zero — with the reason — when the rules are readable and none fires', () => {
    const entry = buildSimulationInventory(mkInput({ predictions: [] })).entries.find(
      (e) => e.id === 'insight-heuristics',
    )!;
    expect(entry.live).toEqual({
      count: 0,
      detail: 'no rule is firing — no condition holds on the current records',
    });
  });

  it('reads null when the rules could not be read at all', () => {
    const entry = buildSimulationInventory(mkInput({ predictions: null })).entries.find(
      (e) => e.id === 'insight-heuristics',
    )!;
    expect(entry.live).toBeNull();
  });

  it('counts the firing predictions it was handed', () => {
    const entry = buildSimulationInventory(mkInput()).entries.find(
      (e) => e.id === 'insight-heuristics',
    )!;
    expect(entry.live).toEqual({ count: 2, detail: '2 prediction(s) firing across the seven rules' });
  });
});

describe('the projection and register entries report their own live readings', () => {
  it('reads P15’s available scenario count, and null when the twin could not be read', () => {
    const readable = buildSimulationInventory(mkInput()).entries.find(
      (e) => e.id === 'p14-scenario-projection',
    )!;
    expect(readable.live).toEqual({ count: 5, detail: '5 scenario(s) available for comparison' });

    const unreadable = buildSimulationInventory(mkInput({ scenarios: null })).entries.find(
      (e) => e.id === 'p14-scenario-projection',
    )!;
    expect(unreadable.live).toBeNull();
  });

  it('reads Stage 12’s registered-capability count, and null when Stage 12 could not be read', () => {
    const readable = buildSimulationInventory(mkInput()).entries.find(
      (e) => e.id === 's12-forecast-inventory',
    )!;
    expect(readable.live).toEqual({
      count: 3,
      detail: '3 forecasting capability(ies) registered',
    });

    const unreadable = buildSimulationInventory(mkInput({ forecasts: null })).entries.find(
      (e) => e.id === 's12-forecast-inventory',
    )!;
    expect(unreadable.live).toBeNull();
  });

  it('registers the forecast inventory as forecasting nothing itself', () => {
    const entry = buildSimulationInventory(mkInput()).entries.find(
      (e) => e.id === 's12-forecast-inventory',
    )!;
    expect(entry.kind).toBe('capability-register');
    expect(entry.cannotSimulate).toContain('forecasts nothing itself');
  });
});

describe('liveInstances sums observations only', () => {
  it('adds up the readable counts and treats a null reading as absent, not as zero', () => {
    // 2 predictions + 5 scenarios + 3 registered = 10; the manufacturing entry
    // contributes nothing because it has nothing to contribute.
    expect(buildSimulationInventory(mkInput()).totals.liveInstances).toBe(10);
  });

  it('drops an unreadable input from the sum without disturbing the others', () => {
    expect(buildSimulationInventory(mkInput({ scenarios: null })).totals.liveInstances).toBe(5);
    expect(buildSimulationInventory(mkInput({ predictions: null })).totals.liveInstances).toBe(8);
    expect(buildSimulationInventory(mkInput({ forecasts: null })).totals.liveInstances).toBe(7);
  });

  it('sums to zero when nothing at all is readable — while every entry stays registered', () => {
    const inv = buildSimulationInventory(
      mkInput({ predictions: null, scenarios: null, forecasts: null }),
    );
    expect(inv.totals.liveInstances).toBe(0);
    expect(inv.totals.registered).toBe(4);
    for (const e of inv.entries) expect(e.live, e.id).toBeNull();
  });

  it('equals the sum of the entries’ own readings in every combination', () => {
    for (const [i, input] of ALL_INPUTS.entries()) {
      const inv = buildSimulationInventory(input);
      const expected = inv.entries.reduce((n, e) => n + (e.live === null ? 0 : e.live.count), 0);
      expect(inv.totals.liveInstances, `input#${i}`).toBe(expected);
    }
  });
});

describe('the view’s own contract', () => {
  it('projects every failure it was handed as a declared unavailability', () => {
    const inv = buildSimulationInventory(
      mkInput({
        predictions: null,
        failures: { 's6-insight': 'predictions threw', 'p15-twin': 'scenario read failed' },
      }),
    );
    expect(inv.unavailable).toEqual([
      { system: 's6-insight', reason: 'predictions threw' },
      { system: 'p15-twin', reason: 'scenario read failed' },
    ]);
  });

  it('stamps the caller’s time and carries the disclosure', () => {
    const inv = buildSimulationInventory(mkInput());
    expect(inv.generatedAt).toBe(NOW);
    expect(inv.disclosure).toBe(SIMULATION_DISCLOSURE);
  });

  it('is deterministic — the same input composes byte-identical output', () => {
    expect(buildSimulationInventory(mkInput())).toEqual(buildSimulationInventory(mkInput()));
  });
});
