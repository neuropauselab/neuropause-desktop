import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  composeEnvironmentModel,
  type RequiredElement,
  type EnvironmentSources,
} from './environmentModel';

const el = (id: string, kind: RequiredElement['kind'] = 'capability'): RequiredElement => ({
  id,
  kind,
  label: id,
});

// One element per state, so a single model exercises all four classifications.
const REQUIRED: RequiredElement[] = [el('mail.send'), el('calendar.read'), el('crm.contacts'), el('drive.files')];
const PROBES: Record<string, 'present' | 'absent' | 'unknown' | null> = {
  'mail.send': 'present', // HAVE
  'calendar.read': 'absent', // NEED
  'crm.contacts': 'unknown', // UNKNOWN
  'drive.files': null, // UNAVAILABLE
};
const sources = (over: Partial<Record<string, 'present' | 'absent' | 'unknown' | null>> = {}): EnvironmentSources => ({
  probe: (e) => ({ ...PROBES, ...over })[e.id] ?? null,
});

describe('L2 · Environment Model — the four states', () => {
  it('each probe result maps to exactly one state; rollups are faithful', () => {
    const m = composeEnvironmentModel('send-email', REQUIRED, sources());
    expect(m.have).toEqual(['mail.send']);
    expect(m.need).toEqual(['calendar.read']);
    expect(m.unknown).toEqual(['crm.contacts']);
    expect(m.unavailable).toEqual(['drive.files']);
    // Every required element is classified — none silently dropped.
    expect(m.elements).toHaveLength(REQUIRED.length);
  });

  it('UNKNOWN NEVER SILENTLY BECOMES HAVE — an all-inconclusive environment yields zero HAVE', () => {
    const allUnknown = composeEnvironmentModel('send-email', REQUIRED, {
      probe: () => 'unknown',
    });
    expect(allUnknown.have).toEqual([]);
    expect(allUnknown.unknown).toHaveLength(REQUIRED.length);
  });

  it('UNAVAILABLE is DISTINCT from NEED — "cannot probe" is never reported as a known gap', () => {
    const m = composeEnvironmentModel('send-email', [el('x')], { probe: () => null });
    expect(m.unavailable).toEqual(['x']);
    expect(m.need).toEqual([]); // an unprobeable element is NOT a NEED
  });
});

describe('L2 · Environment Model — the five acceptance fields', () => {
  it('OBSERVABLE OBJECT — an EnvironmentModel (purpose + classified elements + four rollups)', () => {
    const m = composeEnvironmentModel('send-email', REQUIRED, sources());
    expect(m).toMatchObject({ purpose: 'send-email' });
    expect(Object.keys(m).sort()).toEqual(['elements', 'have', 'need', 'purpose', 'unavailable', 'unknown']);
  });

  it('COLLECTION BOUNDARY (purpose-bound) — probe is called ONLY for the purpose\'s required elements, never a scan', () => {
    const probe = vi.fn((e: RequiredElement) => PROBES[e.id] ?? null);
    composeEnvironmentModel('send-email', REQUIRED, { probe });
    const probedIds = probe.mock.calls.map((c) => c[0].id).sort();
    expect(probedIds).toEqual(REQUIRED.map((r) => r.id).sort()); // exactly the required set — nothing else
    expect(probe).toHaveBeenCalledTimes(REQUIRED.length);
  });

  it('CAPABILITY CONTRACT (DISCOVER ≠ RECOMMEND ≠ BUILD) — the model emits no recommendation and no built artifact', () => {
    const m = composeEnvironmentModel('send-email', REQUIRED, sources());
    expect(JSON.stringify(m)).not.toMatch(/recommend|build|create|execute|grant/i);
  });

  it('VERIFICATION — each element\'s state is a faithful projection of its probe (HAVE⟺present … UNAVAILABLE⟺null)', () => {
    const m = composeEnvironmentModel('send-email', REQUIRED, sources());
    const expected: Record<string, string> = {
      present: 'HAVE',
      absent: 'NEED',
      unknown: 'UNKNOWN',
      null: 'UNAVAILABLE',
    };
    for (const e of m.elements) {
      expect(e.state).toBe(expected[String(PROBES[e.element.id])]);
    }
  });

  it('FAILURE/UNKNOWN — an empty purpose model is empty (never fabricates elements)', () => {
    const m = composeEnvironmentModel('send-email', [], sources());
    expect(m.elements).toEqual([]);
    expect([...m.have, ...m.need, ...m.unknown, ...m.unavailable]).toEqual([]);
  });
});

describe('L2 · Environment Model — invariant', () => {
  it('ZERO-RUNTIME-IMPORT — the model imports NOTHING but its own types', () => {
    const src = readFileSync(join(__dirname, 'environmentModel.ts'), 'utf8');
    const valueImports = src.match(/^import\s+(?!type\b)[^;]*from\s+'[^']*'/gm) ?? [];
    expect(valueImports).toEqual([]);
  });
});
