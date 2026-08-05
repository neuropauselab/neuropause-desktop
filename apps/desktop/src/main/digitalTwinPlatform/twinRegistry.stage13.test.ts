/**
 * Phase 6 Stage 13 — registry integrity + the documentation lock (the S6–S12
 * precedent): the five twin registries are structurally valid, exercise their
 * REAL vocabularies exactly (six surfaces, the seven Phase 6 platforms, the
 * recorded vs point-in-time series, the four existing simulation capabilities,
 * the twenty-two enterprise states), and every claim they make about the
 * repository is shaped like a citation rather than an assertion.
 *
 * The documentation lock here is a CONTENT lock, not a filesystem lock: the
 * sandbox this suite runs in holds a subset of the repository, so probing for
 * `apps/desktop/src/main/twin/twinService.ts` on disk would make the result
 * depend on the checkout rather than on the registry. Every module reference is
 * therefore locked to a repository-path SHAPE, every `modelled-by-twin` row to
 * the P15 domain builder and its line, and every `not-modelled` row to the
 * search that proved the absence plus that search's stated result.
 *
 * The phrase lock against `docs/desktop/twin/TWIN-PLATFORM.md` LANDS HERE now
 * that the document exists (it did not when the rest of this file was written,
 * and a lock over an absent file would have been a lock over nothing). It is a
 * real filesystem read, matching the S12 precedent
 * (`analyticsRegistry.stage12.test.ts`): the doc is a repository artefact, not
 * a checkout-dependent one, so reading it is deterministic in a way that
 * probing for a source module is not.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ETWIN_QUESTION_KEYS } from '@neuropause/shared';
import {
  ETWIN_COVERAGE_STATUSES,
  ETWIN_SERIES_KINDS,
  ETWIN_SIMULATION_KINDS,
  ETWIN_SURFACE_KINDS,
  PLATFORM_REGISTRY,
  SERIES_REGISTRY,
  SIMULATION_REGISTRY,
  STATE_REGISTRY,
  SURFACE_REGISTRY,
  twinRegistryIssues,
} from './twinRegistry';

/** A repository path, optionally naming the symbol inside it. */
const MODULE_PATH = /^(?:apps|packages)\/[A-Za-z0-9._/-]+\.tsx?(?: \([A-Za-z0-9_.]+\))?$/;

describe('registry integrity', () => {
  it('reports zero issues for the shipped registries', () => {
    expect(twinRegistryIssues()).toEqual([]);
  });

  it('locks the registry sizes — six surfaces, seven platforms, seven series, four simulations, twenty-two states', () => {
    expect(SURFACE_REGISTRY).toHaveLength(6);
    expect(PLATFORM_REGISTRY).toHaveLength(7);
    expect(SERIES_REGISTRY).toHaveLength(7);
    expect(SIMULATION_REGISTRY).toHaveLength(4);
    expect(STATE_REGISTRY).toHaveLength(22);
  });

  it('uses no id twice ACROSS the five registries, not merely within each', () => {
    const ids = [
      ...SURFACE_REGISTRY.map((r) => r.id),
      ...PLATFORM_REGISTRY.map((r) => r.id),
      ...SERIES_REGISTRY.map((r) => r.id),
      ...SIMULATION_REGISTRY.map((r) => r.id),
      ...STATE_REGISTRY.map((r) => r.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exercises every declared kind and status — no vocabulary member is dead', () => {
    const surfaceKinds = new Set(SURFACE_REGISTRY.map((r) => r.kind));
    for (const k of ETWIN_SURFACE_KINDS) expect(surfaceKinds.has(k), k).toBe(true);

    const seriesKinds = new Set(SERIES_REGISTRY.map((r) => r.kind));
    for (const k of ETWIN_SERIES_KINDS) expect(seriesKinds.has(k), k).toBe(true);

    const simKinds = new Set(SIMULATION_REGISTRY.map((r) => r.kind));
    for (const k of ETWIN_SIMULATION_KINDS) expect(simKinds.has(k), k).toBe(true);

    const statuses = new Set(STATE_REGISTRY.map((r) => r.status));
    for (const s of ETWIN_COVERAGE_STATUSES) expect(statuses.has(s), s).toBe(true);
  });

  it('declares no kind or status the vocabulary does not contain', () => {
    for (const r of SURFACE_REGISTRY) expect(ETWIN_SURFACE_KINDS).toContain(r.kind);
    for (const r of SERIES_REGISTRY) expect(ETWIN_SERIES_KINDS).toContain(r.kind);
    for (const r of SIMULATION_REGISTRY) expect(ETWIN_SIMULATION_KINDS).toContain(r.kind);
    for (const r of STATE_REGISTRY) expect(ETWIN_COVERAGE_STATUSES).toContain(r.status);
  });
});

describe('surfaces — the two shipped twins plus the estate they never saw', () => {
  it('registers exactly the six verified surfaces', () => {
    expect([...SURFACE_REGISTRY.map((s) => s.id)].sort()).toEqual(
      [
        'p15-enterprise-twin',
        'manufacturing-twin',
        'execute-engine',
        'runtime-supervisor',
        'health-history',
        'decision-store',
      ].sort(),
    );
  });

  it('names P15 and the manufacturing twin as the two twin surfaces, and the other four as the composed estate', () => {
    const byId = new Map(SURFACE_REGISTRY.map((s) => [s.id, s]));
    expect(byId.get('p15-enterprise-twin')!.kind).toBe('enterprise-twin');
    expect(byId.get('manufacturing-twin')!.kind).toBe('manufacturing-twin');
    expect(byId.get('execute-engine')!.kind).toBe('execution-surface');
    expect(byId.get('runtime-supervisor')!.kind).toBe('runtime-surface');
    expect(byId.get('health-history')!.kind).toBe('observation-surface');
    expect(byId.get('decision-store')!.kind).toBe('observation-surface');
  });

  it('states, on every surface, what Stage 13 reuses — a surface with no reuse statement is an unexplained dependency', () => {
    for (const s of SURFACE_REGISTRY) {
      expect(s.reuse.length, s.id).toBeGreaterThan(0);
      expect(s.stage.length, s.id).toBeGreaterThan(0);
      expect(s.label.length, s.id).toBeGreaterThan(0);
    }
  });
});

describe('platforms — the seven Phase 6 stages built after P15', () => {
  it('registers the seven platform ids in stage order', () => {
    expect(PLATFORM_REGISTRY.map((p) => p.id)).toEqual([
      's6-insight',
      's7-knowledge',
      's8-automation',
      's9-operations',
      's10-strategy',
      's11-federation',
      's12-analytics',
    ]);
    expect(PLATFORM_REGISTRY.map((p) => p.stage)).toEqual([
      'Stage 6',
      'Stage 7',
      'Stage 8',
      'Stage 9',
      'Stage 10',
      'Stage 11',
      'Stage 12',
    ]);
  });

  it('describes, for every platform, the ALREADY-COMPUTED slice Stage 13 takes — never a recomputation', () => {
    for (const p of PLATFORM_REGISTRY) {
      expect(p.slice.length, p.id).toBeGreaterThan(0);
      expect(p.slice, p.id).toContain('already computed by');
    }
  });
});

describe('series — recorded is trendable, composed-per-read is not', () => {
  it('marks exactly the three recorded series trendable and the four point-in-time compositions untrendable', () => {
    expect(SERIES_REGISTRY.filter((s) => s.trendable).map((s) => s.id)).toEqual([
      'org-health-history',
      'engineering-health-history',
      'decision-window-deltas',
    ]);
    expect(SERIES_REGISTRY.filter((s) => !s.trendable).map((s) => s.id)).toEqual([
      'twin-domain-entities',
      'twin-overall-health',
      'execution-sessions',
      'supervisor-recoveries',
    ]);
  });

  it('never claims a point-in-time composition is trendable — the exact dishonesty the registry exists to prevent', () => {
    for (const s of SERIES_REGISTRY) {
      if (s.kind === 'point-in-time') expect(s.trendable, s.id).toBe(false);
      if (s.trendable) expect(s.kind, s.id).not.toBe('point-in-time');
    }
  });

  it('explains every untrendable series rather than omitting it', () => {
    for (const s of SERIES_REGISTRY.filter((x) => !x.trendable)) {
      expect(s.detail.length, s.id).toBeGreaterThan(0);
    }
  });
});

describe('simulations — a register of what exists, with authored counts only where one is authored', () => {
  it('registers the four existing capabilities and their real scenario counts', () => {
    const byId = new Map(SIMULATION_REGISTRY.map((s) => [s.id, s]));
    expect([...byId.keys()].sort()).toEqual(
      ['p14-scenario-projection', 'manufacturing-what-if', 'insight-heuristics', 's12-forecast-inventory'].sort(),
    );
    // Authored, countable, verified in the repository.
    expect(byId.get('manufacturing-what-if')!.scenarioCount).toBe(15);
    expect(byId.get('insight-heuristics')!.scenarioCount).toBe(7);
    // No authored count exists for either of these; null says so rather than 0.
    expect(byId.get('p14-scenario-projection')!.scenarioCount).toBeNull();
    expect(byId.get('s12-forecast-inventory')!.scenarioCount).toBeNull();
  });

  it('states what every capability CANNOT do, not only what it can', () => {
    for (const s of SIMULATION_REGISTRY) {
      expect(s.canSimulate.length, s.id).toBeGreaterThan(0);
      expect(s.cannotSimulate.length, s.id).toBeGreaterThan(0);
    }
  });
});

describe('state coverage — twenty-two states, split nine / ten / three', () => {
  it('locks the coverage split', () => {
    const by = (status: string) => STATE_REGISTRY.filter((s) => s.status === status);
    expect(by('modelled-by-twin')).toHaveLength(9);
    expect(by('modelled-elsewhere')).toHaveLength(10);
    expect(by('not-modelled')).toHaveLength(3);
  });

  it('carries P15’s nine domains and claims no tenth', () => {
    expect(STATE_REGISTRY.filter((s) => s.status === 'modelled-by-twin').map((s) => s.id)).toEqual([
      'enterprise-posture',
      'organization',
      'infrastructure',
      'workforce',
      'application',
      'connectors',
      'marketplace',
      'federation',
      'strategy',
    ]);
  });

  it('names exactly the three states nothing in the repository models', () => {
    expect(STATE_REGISTRY.filter((s) => s.status === 'not-modelled').map((s) => s.id)).toEqual([
      'physical-sensor-telemetry',
      'physical-facility-geography',
      'energy-environmental',
    ]);
  });
});

describe('documentation lock — every reference is shaped like a citation', () => {
  it('names a real repository path in every surface, platform, series and simulation module reference', () => {
    const modules = [
      ...SURFACE_REGISTRY.map((r) => [r.id, r.module] as const),
      ...PLATFORM_REGISTRY.map((r) => [r.id, r.module] as const),
      ...SERIES_REGISTRY.map((r) => [r.id, r.module] as const),
      ...SIMULATION_REGISTRY.map((r) => [r.id, r.module] as const),
    ];
    // Every module reference in all four registries, and there are no untested
    // registries left: STATE_REGISTRY cites through `evidence` instead.
    expect(modules).toHaveLength(24);
    for (const [id, module] of modules) {
      expect(MODULE_PATH.test(module), `${id}: ${module}`).toBe(true);
    }
  });

  it('cites the P15 domain builder, with its line, on every modelled-by-twin row', () => {
    for (const s of STATE_REGISTRY.filter((x) => x.status === 'modelled-by-twin')) {
      expect(s.owner, s.id).toMatch(/^P15 twin domain `[a-z]+`$/);
      expect(s.evidence, s.id).toMatch(
        /^apps\/desktop\/src\/main\/twin\/twinModel\.ts:\d+ — buildTwinDomains$/,
      );
    }
  });

  it('names an owning module outside the twin on every modelled-elsewhere row', () => {
    for (const s of STATE_REGISTRY.filter((x) => x.status === 'modelled-elsewhere')) {
      expect(s.owner.length, s.id).toBeGreaterThan(0);
      expect(s.evidence, s.id).toContain('apps/desktop/src/main/');
    }
  });

  it('cites the SEARCH that proved the absence, and that search’s result, on every not-modelled row', () => {
    const notModelled = STATE_REGISTRY.filter((x) => x.status === 'not-modelled');
    expect(notModelled).toHaveLength(3);
    for (const s of notModelled) {
      // A gap is only honest if it says what would be required to close it...
      expect(s.owner, s.id).toMatch(/^None\. Would require /);
      // ...and shows the search rather than asserting the absence.
      expect(s.evidence, s.id).toMatch(/^Searching apps\/desktop\/src\/main\/\*\*\/\*\.ts for /);
      const statesResult =
        s.evidence.includes('returns zero matches') || s.evidence.includes('matches ONLY');
      expect(statesResult, `${s.id}: evidence states no search result`).toBe(true);
    }
  });

  it('leaves no state row without evidence — a coverage claim without a citation is an unverified assertion', () => {
    for (const s of STATE_REGISTRY) {
      expect(s.evidence.length, s.id).toBeGreaterThan(0);
      expect(s.label.length, s.id).toBeGreaterThan(0);
      expect(s.owner.length, s.id).toBeGreaterThan(0);
    }
  });
});

describe('registry ↔ doc lock (docs/desktop/twin/TWIN-PLATFORM.md)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const doc = readFileSync(join(here, '../../../../../docs/desktop/twin/TWIN-PLATFORM.md'), 'utf8');
  /**
   * Whitespace-collapsed. Prose phrases are asserted against this rather than
   * against `doc`, because the lock is about what the document SAYS — a phrase
   * that happens to straddle a line wrap is still stated. Backticked ids are
   * single tokens and cannot wrap, so either form works for those.
   */
  const FLAT = doc.replace(/\s+/g, ' ');

  it('documents every surface, platform, series, simulation and state id', () => {
    for (const s of SURFACE_REGISTRY) expect(doc, s.id).toContain(`\`${s.id}\``);
    for (const p of PLATFORM_REGISTRY) expect(doc, p.id).toContain(`\`${p.id}\``);
    for (const s of SERIES_REGISTRY) expect(doc, s.id).toContain(`\`${s.id}\``);
    for (const s of SIMULATION_REGISTRY) expect(doc, s.id).toContain(`\`${s.id}\``);
    for (const s of STATE_REGISTRY) expect(doc, s.id).toContain(`\`${s.id}\``);
    // The whole vocabulary, not a sample of it: 6 + 7 + 7 + 4 + 22.
    expect(
      SURFACE_REGISTRY.length +
        PLATFORM_REGISTRY.length +
        SERIES_REGISTRY.length +
        SIMULATION_REGISTRY.length +
        STATE_REGISTRY.length,
    ).toBe(46);
  });

  it('documents every surface kind, series kind, simulation kind and coverage status', () => {
    for (const k of ETWIN_SURFACE_KINDS) expect(doc, k).toContain(`\`${k}\``);
    for (const k of ETWIN_SERIES_KINDS) expect(doc, k).toContain(`\`${k}\``);
    for (const k of ETWIN_SIMULATION_KINDS) expect(doc, k).toContain(`\`${k}\``);
    for (const k of ETWIN_COVERAGE_STATUSES) expect(doc, k).toContain(`\`${k}\``);
  });

  it('documents the seven etwin:* channels, the REUSED twin:read scope, and the watch source', () => {
    for (const ch of [
      'etwin:runtime',
      'etwin:platforms',
      'etwin:coverage',
      'etwin:simulation',
      'etwin:history',
      'etwin:dashboard',
      'etwin:report',
    ]) {
      expect(doc, ch).toContain(`\`${ch}\``);
    }
    expect(doc).toContain('`twin:read`');
    expect(doc).toContain('No new permission is minted');
    expect(doc).toContain('`twin-watch`');
    // The namespace beside P15's, never over it.
    expect(doc).toContain('`etwin:*`');
    expect(doc).toContain('`twin:*`');
  });

  it('documents all ten assistant question keys', () => {
    for (const k of ETWIN_QUESTION_KEYS) expect(doc, k).toContain(`\`${k}\``);
    expect(ETWIN_QUESTION_KEYS).toHaveLength(10);
  });

  it('documents the five recommendation rules by id', () => {
    for (const r of [
      'etwinrec:platform:attention',
      'etwinrec:platform:unknown',
      'etwinrec:runtime:failed',
      'etwinrec:runtime:supervisor',
      'etwinrec:twin:band',
    ]) {
      expect(doc, r).toContain(`\`${r}\``);
    }
  });

  it('states the structural honesty: no engine, P15 authoritative, registered-never-invoked, declared-untrendable, null-is-not-zero', () => {
    for (const phrase of [
      'NOT a twin engine',
      'composes, never computes',
      'P15 remains the authoritative twin',
      'no mutation surface',
      'Stage 13 invokes nothing',
      'declared untrendable',
      'never rendered as zero',
      'never assumed steady',
      'No dashboard logic is duplicated',
      'No gap is asserted without evidence',
      // The partial-engine rule is the stage's least obvious honesty guarantee,
      // so the document has to carry it rather than leave it to a source comment.
      'partial-engine rule',
      'half-composed',
    ]) {
      expect(FLAT, phrase).toContain(phrase);
    }
  });

  /**
   * This test previously locked the OPPOSITE: that the document mentioned
   * `etwin:report` exactly once, to say it did not exist. That was the honest
   * form while the channel was missing, and it was written to fail on the day
   * the channel was minted. It did. What replaces it is not silence — a
   * document that simply started listing seven channels would leave no trace
   * that it ever listed six, and the deviation from the audit's tabulated six
   * would vanish from the record. So the document must still carry the finding,
   * and this locks that it does.
   */
  it('records FINDING #5 as resolved AND keeps the six→seven deviation on the record', () => {
    expect(FLAT).toContain('FINDING #5');
    expect(FLAT).toContain('FINDING #5, resolved');
    // The channel is now real, so it appears in the channel list AND in the
    // paragraph that explains where it came from — no longer exactly once.
    expect(FLAT.match(/`etwin:report`/g)!.length).toBeGreaterThanOrEqual(2);
    // The old negation is gone, not merely contradicted elsewhere.
    expect(FLAT).not.toContain('there is **no `etwin:report` channel**');
    // The deviation is stated in the document itself, not only in a commit
    // message or a chat transcript: the audit said six, seven ship, and the
    // reason is written down where a reader of the docs will find it.
    expect(FLAT).toContain('the audit tabulated SIX');
    expect(FLAT).toContain('Seven ship');
    expect(FLAT).toContain('The count moved from six to seven');
    // …and what did NOT change is stated with it, because a bare count change
    // reads like scope creep unless the invariants are named.
    expect(FLAT).toContain('the zero-mutation guarantee did not move at all');
  });

  /**
   * FINDING #7 — the renderer path, and the correction of a wrong lock.
   *
   * This test previously asserted the OPPOSITE: that the tab lived at
   * `renderer/src/twinCenter/EtwinPlatformTab.tsx`. It was written on the
   * audit's §5.6 and on a reason that sounded solid — the repository vitest glob
   * already covers the Center directory, so a tab there needs no config change
   * while a new renderer directory would. Listing the renderer tree disproved
   * the reason. All four sibling stages put the tab and the model in a
   * stage-named PLATFORM directory and put only the TEST in the Center
   * directory, so what sits inside the glob is the test file, and source
   * placement never entered into it. The old assertion was locking an error in
   * place; it is corrected here rather than deleted, so the record shows the
   * path was reasoned about twice and why the second answer differs.
   *
   * The old text was wrong a second, independent way: it named
   * `twinCenter/twinCenterModel.ts` as the view-model's home. That file is
   * P15's own presentation model, and putting Stage 13 logic in it would have
   * modified P15 — a D-1 violation, not a filing preference.
   */
  it('FINDING #7 — names the stage-named renderer directory the four siblings actually use', () => {
    // The corrected path: source beside the stage, mirroring main/.
    expect(FLAT).toContain('`renderer/src/digitalTwinPlatform/EtwinPlatformTab.tsx`');
    expect(FLAT).toContain('`renderer/src/digitalTwinPlatform/etwinPlatformModel.ts`');
    // …and the TEST in the Center directory, which is the part the glob cares
    // about. Asserting both together is the whole point: the split IS the
    // convention, and naming only one half would re-open the same mistake.
    expect(FLAT).toContain('`twinCenter/etwinPlatformModel.stage13.test.ts`');

    /*
     * The wrong path is NOT simply absent, and asserting that it was would have
     * been the easy lie here: a finding that cannot name the thing it corrects
     * is not a finding. So the lock is the precise statement instead — the wrong
     * path appears exactly ONCE, and that one occurrence is inside the FINDING
     * paragraph, after the marker. A reintroduction anywhere else, including a
     * relapse in the declaration above, moves the first occurrence before the
     * marker or pushes the count past one, and this fails.
     */
    const WRONG = '`renderer/src/twinCenter/EtwinPlatformTab.tsx`';
    expect(FLAT.split(WRONG).length - 1).toBe(1);
    expect(FLAT.indexOf(WRONG)).toBeGreaterThan(FLAT.indexOf('FINDING #7'));
    // …and the declaration that precedes the finding names the right one.
    const declaration = FLAT.slice(FLAT.indexOf('## Renderer'), FLAT.indexOf('FINDING #7'));
    expect(declaration).toContain('`renderer/src/digitalTwinPlatform/EtwinPlatformTab.tsx`');
    expect(declaration).not.toContain(WRONG);

    // The finding is on the record with the evidence that settled it: four
    // sibling stages, named, so a reader can re-check the claim without
    // trusting this file.
    expect(FLAT).toContain('FINDING #7');
    expect(FLAT).toContain("the audit's §5.6 renderer path is incorrect");
    for (const sibling of [
      '`operationsPlatform/eopsPlatformModel.ts`',
      '`operationsCenter/eopsPlatformModel.stage9.test.ts`',
      '`strategyPlatform/EstratPlatformTab.tsx`',
      '`strategyCenter/estratPlatformModel.stage10.test.ts`',
      '`enterpriseFederation/EfedPlatformTab.tsx`',
      '`federationCenter/efedPlatformModel.stage11.test.ts`',
      '`enterpriseAnalytics/EanaPlatformTab.tsx`',
      '`insightCenter/eanaPlatformModel.stage12.test.ts`',
    ]) {
      expect(FLAT, sibling).toContain(sibling);
    }

    // The D-1 half of the finding: P15's model is named as P15's and is not
    // where Stage 13 logic goes.
    expect(FLAT).toContain('`twinCenter/twinCenterModel.ts`');
    expect(FLAT).toContain('in violation of D-1');

    // What did NOT change, stated for the same reason the six→seven deviation
    // states it: a moved directory reads like drift unless the invariants are
    // named beside it.
    expect(FLAT).toContain('no vitest config change');
    expect(FLAT).toContain('The seven existing tabs are untouched');
  });

  /*
   * FINDING #8 — the wording lock, built on the same principle as #7: a finding
   * that cannot quote what it corrects is not a finding, so the lock is NOT
   * that `no navigation change` is absent from the document.
   *
   * The phrase was true under this codebase's own narrow convention — Stage 12
   * says it in `InsightCenterHost.tsx` while constructing a `<nav>` — and false
   * under the reading someone checking the diff actually applies, because the
   * Stage 13 wiring does append a tab entry. So the invariant is POSITIONAL:
   * every occurrence sits after the finding's own heading, which means the two
   * declarations that used to carry the denial now carry the precise statement
   * instead. A relapse in either one puts an occurrence before the heading and
   * fails here.
   *
   * The heading is matched with its `**` rather than as bare `FINDING #8`,
   * because the Design-decisions bullet cross-references the finding by name and
   * appears EARLIER in the document — slicing at the bare id would silently move
   * the boundary above the Renderer section and stop guarding it.
   */
  it('FINDING #8 — states the appended nav entry instead of denying it', () => {
    const heading = FLAT.indexOf('**FINDING #8 —');
    expect(heading).toBeGreaterThan(-1);

    // The denial survives only as the thing being corrected.
    expect(FLAT.slice(0, heading)).not.toContain('no navigation change');
    expect(FLAT.slice(heading)).toContain('no navigation change');

    // What replaced it, precise on every count the denial used to blur.
    expect(FLAT).toContain('no app-level navigation change');
    expect(FLAT).toContain("`{ id: 'platform', label: 'Platform', icon: 'server' }`");
    expect(FLAT).toContain('same ids, labels, icons and order');
    expect(FLAT).toContain('appended');

    // The evidence that settled the convention question is named, so a reader
    // can re-check the claim in the sibling stage instead of trusting this file
    // — the same standard FINDING #7 is held to. The quote is asserted in two
    // halves so the assertion does not depend on the dash character between them.
    expect(FLAT).toContain('`insightCenter/InsightCenterHost.tsx`');
    expect(FLAT).toContain('"No new Center, no navigation changes');
    expect(FLAT).toContain('one tab inside the existing workspace"');

    // The icon correction, locked because it is the half a reader is most
    // likely to assume was arbitrary: `grid` was already taken in that strip.
    expect(FLAT).toContain('`grid`');
    expect(FLAT).toContain('S10 `globe`, S11 `checklist`');
  });

  /*
   * The icon claim above is the one thing in this stage a typechecker cannot
   * confirm: `components/ui/Icon.tsx` is outside this checkout, so `IconName`
   * degrades to `any` and `server` would pass compilation even misspelled.
   *
   * That is disclosed rather than left for a reader to discover, and the
   * disclosure is locked — an undisclosed limitation is the failure mode this
   * whole document is built against, and a limitation is easiest to delete
   * silently later, when the tab looks finished and the sentence reads like
   * hedging. The citation that stands in for the missing check is locked with
   * it, so the disclosure can never decay into an unsupported "trust me".
   */
  it('discloses that no icon literal is typechecked, and cites what stands in for it', () => {
    expect(FLAT).toContain('**Stated limitation — no icon name on this tab is gated by a typechecker.**');
    expect(FLAT).toContain('`IconName` degrades to `any`');

    // The citation: P15's OWN model, annotated, in the Center this tab joins.
    expect(FLAT).toContain('`twinCenter/twinCenterModel.ts`');
    expect(FLAT).toContain('`Record<TwinDomainId, IconName>`');
    expect(FLAT).toContain('`REPLAY_ICON`');

    // …and the scope of the gap stated honestly: it is every icon, not just one.
    expect(FLAT).toContain('Every other icon on the Platform tab was taken from a shipped file');
  });

  /*
   * FINDING #9 — the registration gap, now closed, and the premise that turned
   * out to be false. The original lock guarded against rounding an unfinished
   * stage up to "done". That risk is gone; the opposite one replaced it, and it
   * is worse, because closing a finding is the moment its history is easiest to
   * delete. The finding claimed the wiring COULD NOT be written — the files did
   * not exist. They did. A document that now simply describes working wiring
   * would be accurate about the code and would have quietly erased a wrong
   * conclusion, which is the failure this whole disclosure regime exists to stop.
   *
   * So the lock holds the resolution and the retraction together: that the three
   * lines exist, that the stated reason for their absence was false, WHY it was
   * false (a stale snapshot of a partial checkout), and the second claim that
   * false premise nearly licensed — that shipping unwired was the house pattern.
   */
  it('FINDING #9 — records the wiring as landed AND retracts the premise that it could not be', () => {
    const heading = FLAT.indexOf('**FINDING #9,');
    expect(heading).toBeGreaterThan(-1);

    // The resolution, in the terms the gap was originally stated in.
    expect(FLAT).toContain('The three lines are');
    expect(FLAT).toContain('row in `SELF_GATED_PREFIXES`');

    // The retraction: the exact words that were wrong, kept so the search that
    // finds the old claim also finds its correction.
    expect(FLAT).toContain('neither file is in this checkout');
    expect(FLAT).toContain('task #1429');
    expect(FLAT).toContain('Both files existed, and always had');

    // WHY it was wrong — a retraction without a cause is an apology, not a
    // finding. The byte counts are the evidence and are quoted, not gestured at.
    expect(FLAT).toContain('94,332 bytes against the real 130,732');
    expect(FLAT).toContain('`initAssistant` has no caller anywhere here');
    expect(FLAT).toContain('Stage 12 was not unwired; nothing was');

    // The larger claim the false premise nearly licensed. This is the part a
    // tidy-up would drop first, because it is about a mistake that never
    // shipped — which is exactly why it is locked.
    expect(FLAT).toContain('would have been the established pattern');
    expect(FLAT).toContain('can license exactly the wrong repair');

    // The half that WAS real survives the correction unchanged.
    expect(FLAT).toContain('`SecureHandlerDef`s');
    expect(FLAT).toContain("`permission: 'twin:read'`");
    expect(FLAT).toContain('`index.stage13.test.ts` proves that for all seven');

    /*
     * The positional guard, inverted from the original. The IPC section above
     * now states coverage in the present tense, and the retracted denial
     * survives only inside the finding that retracts it — so a relapse into
     * "does not yet cover" above the heading fails here.
     */
    expect(FLAT.slice(0, heading)).toContain('covers the `etwin:` namespace');
    expect(FLAT.slice(0, heading)).not.toContain('does **not** yet cover the `etwin:` namespace');
  });

  /*
   * FINDING #9's consequence — the unavailable payload. The original lock was
   * written against this payload rather than against a count, on the reasoning
   * that wiring the port is precisely what stops the service emitting it, so the
   * assertion could not survive a real fix. The port is now wired and the
   * assertion still stands, which needs explaining rather than deleting: the
   * payload is no longer what a twin question returns, it is what an UNWIRED
   * port returns, and that behaviour is still locked in
   * assistantTwin.stage13.test.ts. Wiring is an edit; edits get reverted. The
   * refusal has to stay honest the next time someone removes the supply.
   */
  it('FINDING #9 — keeps the unavailable payload as the unwired-port contract, not as current behaviour', () => {
    const heading = FLAT.indexOf('**FINDING #9,');
    expect(heading).toBeGreaterThan(-1);

    // The payload, quoted as the service emits it.
    expect(FLAT).toContain(
      "`unavailable: { system: 'twin', reason: 'twin platform port not wired' }`",
    );
    // …explicitly in the past tense, so it is never read as today's behaviour.
    expect(FLAT).toContain('before the supply landed');
    // …and the reason the lock outlives the fix.
    expect(FLAT).toContain('can be unwired by a future edit');

    // The assistant section states the supply, and states it as a supply from a
    // named file — "declared on both ends" alone was what made the original gap
    // invisible for as long as it was.
    expect(FLAT).toContain('supplied by `runtimeCore.ts`');

    // The method that found the gap is kept, because it was right; what it was
    // applied to was not.
    expect(FLAT).toContain('`assistantTwin.stage13.test.ts` locks the path between them');
    expect(FLAT).toContain('It was applied to the wrong tree');
  });

  /*
   * FINDING #10 — the port NAME. This is the easiest deviation in the stage to
   * leave unrecorded: it typechecks, every test passes, and an audit is a
   * document nobody re-opens. It matters for one concrete reason, and only that
   * reason — the line that would USE the name has not been written yet
   * (FINDING #9), so whoever writes it will be reading §5.5 and will type a name
   * that does not exist. The lock therefore demands BOTH spellings be present:
   * the one the audit asks for, so the search lands, and the one that ships.
   */
  it('FINDING #10 — records the audit port name beside the shipped one, and why they differ', () => {
    const heading = FLAT.indexOf('**FINDING #10 —');
    expect(heading).toBeGreaterThan(-1);

    // Both spellings, so a reader arriving from §5.5 lands on the difference
    // rather than on silence.
    expect(FLAT).toContain('`twinPlatformAnswer`');
    expect(FLAT).toContain('**`twinAnswer`**');

    // The reason, named rather than gestured at: a convention is only evidence
    // if the instances are listed and can be checked.
    for (const sibling of [
      '`intelligenceAnswer`',
      '`knowledgeAnswer`',
      '`automationAnswer`',
      '`operationsAnswer`',
      '`strategyAnswer`',
      '`federationAnswer`',
      '`analyticsAnswer`',
    ]) {
      expect(FLAT, sibling).toContain(sibling);
    }

    // What makes it a decision rather than a preference: the collision the
    // longer name would have guarded against was looked for and is not there.
    expect(FLAT).toContain('`AssistantSubsystemDeps` or `AssistantServiceDeps`, checked field');
    expect(FLAT).toContain('has no assistant port at all');

    // And the scope, so a NAME deviation is never read as a wider one.
    expect(FLAT).toContain('The deviation is a NAME only');
    expect(FLAT).toContain('the ten keys are all the audit');

    // The audit's spelling survives only inside the finding that explains it.
    // If it reappears above as though it were what shipped, this fails.
    expect(FLAT.slice(0, heading)).not.toContain('`twinPlatformAnswer`');
  });

  it('cites BOTH halves of the assistant lock, and states what divides them', () => {
    // Naming one test file implies the other does not exist. Both are named,
    // with the boundary between them, because the interesting failures live in
    // neither file alone — see that file's header for the four controls.
    expect(FLAT).toContain('`twinPlatformModel.stage13.test.ts`');
    expect(FLAT).toContain(
      'The service half is locked separately in `assistantTwin.stage13.test.ts`',
    );
    expect(FLAT).toContain('dispatch, isolation of the eight earlier ports');
    expect(FLAT).toContain('branch ORDER');
    expect(FLAT).toContain('a resolver test cannot see which branch answers first');
    expect(FLAT).toContain('a service test cannot see a widening that branch order never reaches');

    // "Measured" is the load-bearing word: it is what separates this from a
    // plausible story about two files that happen to both be green.
    expect(FLAT).toContain('measured with four negative controls rather than assumed');
    expect(FLAT).toContain('one of them falsified the first draft');
  });

  it('says the port IS supplied WHERE the port is described, and keeps the refusal named', () => {
    /*
     * This lock inverted when the wiring landed, and the inversion is the point
     * of keeping it rather than deleting it.
     *
     * It was written when nothing supplied the port, to force the disclosure
     * into BOTH places: describing ten answerable questions here while the
     * "nothing supplies it" sat forty lines above, inside a finding about IPC
     * handlers, is how a document manages to be true line by line and still
     * mislead. `runtimeCore.ts` now supplies `twinAnswer`, so the same argument
     * runs the other way — a reader who arrives at the Assistant section must
     * learn the port is live HERE, not have to reach FINDING #9 to discover the
     * gap closed. A stale "supplied on neither" in this section would now be
     * the mislead, so it is barred outright.
     *
     * What survives is the refusal. The unavailable payload is still the
     * contract for an unsupplied port and `assistantTwin.stage13.test.ts` still
     * locks it, because supply is one line in one file and can be removed by an
     * edit that never opens this directory. So the section is required to name
     * BOTH: the live wiring, and the failure that stays honest without it. The
     * slice is still bounded at the next heading so neither half can be
     * satisfied from elsewhere in the document.
     */
    const start = FLAT.indexOf('## Assistant (D-8) + monitoring');
    const end = FLAT.indexOf('## Renderer');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = FLAT.slice(start, end);

    // The wiring, stated where the port is described.
    expect(section).toContain('supplied by `runtimeCore.ts`');
    expect(section).toContain('so a twin question is answered');

    // The retracted state may not survive anywhere in this section.
    expect(section).not.toContain('supplied on neither');

    // …but the refusal it described is still locked as behaviour, and still
    // reachable from here, because the supply is one removable line.
    expect(section).toContain('FINDING #9');
    expect(section).toContain('still locks that refusal as behaviour');
    expect(section).toContain('can be removed by a later edit');
  });

  /*
   * FINDING #11 — the bench verdict. Every other lock in this file guards a
   * claim about the repository; this one guards a claim about the SUITE, and it
   * exists because the stage's own documentation asserted determinism the stage
   * does not have. A wall-clock budget is deterministic in its inputs and
   * nondeterministic in its verdict, and the difference is invisible for as long
   * as the margin holds — which is exactly how it survives review.
   *
   * The lock is built on the observation rather than on the argument, because
   * the argument alone reads as caution and gets softened. The Stage 7 sibling
   * was seen failing, at a figure this file records; that figure is a historical
   * measurement, so pinning it is not pinning a benchmark — and the two Stage 13
   * numbers beside it are what keeps the finding from overstating: this stage
   * has margin, and margin is named as margin rather than as safety.
   */
  it('FINDING #11 — records the bench as nondeterministic, with the failure that proved it', () => {
    const heading = FLAT.indexOf('**FINDING #11 —');
    expect(heading).toBeGreaterThan(-1);

    // The mechanism, stated as a property of the assertion and not of the code.
    expect(FLAT).toContain('a budget assertion is a wall-clock comparison');
    expect(FLAT).toContain('the VERDICT is not');

    // The observation, which is what makes this a finding rather than a worry.
    // The numerator and the one measured figure are the durable parts, so they
    // are what gets pinned: a failure that happened stays happened.
    expect(FLAT).toContain('`knowledgeAssets/knowledgeBench.test.ts`');
    expect(FLAT).toContain('three times on its own ≤ 100 ms budget');
    expect(FLAT).toContain('once at a measured 124.19 ms');
    expect(FLAT).toContain('passing three of three runs in isolation');

    /*
     * The denominator is pinned DIFFERENTLY, and this block is the reason.
     *
     * Written as a bare ratio the tally falsified itself twice inside one
     * session — two-in-five, three-in-eight, three-in-ten — not because the
     * measurement was wrong each time but because running the suite to verify
     * the sentence is what moved the number the sentence reported. A figure
     * that its own verification invalidates cannot be locked by pinning its
     * digits; the lock would just fail on the next green run and get "fixed"
     * by bumping the number, which trains the next author to treat the count
     * as bookkeeping rather than as evidence.
     *
     * So the doc now states the shape (numerator durable, denominator only
     * grows, failures unmoved since run eight) and these assertions pin THAT.
     * A passing run no longer contradicts the paragraph. A failing one does,
     * and has to be written down — which is the only direction that carries
     * information.
     */
    expect(FLAT).toContain('at the time of writing the tally stood at three in ten');
    expect(FLAT).toContain('the failure count has not moved since the eighth run');
    expect(FLAT).toContain('it read two-in-five, then three-in-eight, then three-in-ten');
    expect(FLAT).toContain('a flake is not disproved by passing');

    /*
     * One banned phrasing, not a family of them. `across five full-suite runs`
     * was the original stale claim FORM — a ratio presented as the settled
     * rate — and banning it catches a half-revert that updates one mention and
     * leaves another. It is deliberately NOT extended to every superseded
     * denominator: the paragraph above legitimately recites two-in-five and
     * three-in-eight as history, and a ban broad enough to stop the stale
     * claim would also stop the disclosure that names it.
     */
    expect(FLAT).not.toContain('across five full-suite runs');

    // The counterweight: Stage 13's own margin, measured the same way.
    expect(FLAT).toContain('1.3 ms runtime-twin build against 100 ms');
    expect(FLAT).toContain('0.3 ms dashboard build against 500 ms');

    // …and margin named as margin. Without this the numbers above read as a
    // clean bill of health, which is the failure mode the finding is about.
    expect(FLAT).toContain('It is not determinism, and it is not recorded as determinism');

    // What was NOT done, and why — the two corrections this finding declines to
    // make are as load-bearing as the one it makes.
    expect(FLAT).toContain('writing down a number no measurement supports');
    expect(FLAT).toContain('is not weakened from here');

    /*
     * The withdrawn claim, guarded positionally like #8 and #9 — and guarded
     * TWICE, because the first draft of this block guarded only the retraction
     * sentence and a negative control walked straight through it: inserting a
     * bare "Deterministic." into the Performance section above reinstated the
     * exact claim being retracted while every assertion here stayed green. The
     * word itself is what relapses, not the sentence that retracts it.
     *
     * The ban is scoped to this section rather than to the document, because
     * "deterministic" is a legitimate word elsewhere — the registries, the
     * fixtures and the resolver genuinely are — and a document-wide ban would be
     * a lock that forces a false statement somewhere else to stay green here.
     */
    expect(FLAT.slice(0, heading)).not.toContain('used to head itself "Deterministic"');
    expect(FLAT.slice(heading)).toContain('used to head itself "Deterministic"');

    const perf = FLAT.indexOf('## Performance (test-enforced budgets)');
    expect(perf).toBeGreaterThan(-1);
    expect(perf).toBeLessThan(heading);
    expect(FLAT.slice(perf, heading).toLowerCase()).not.toContain('deterministic');
  });
});
