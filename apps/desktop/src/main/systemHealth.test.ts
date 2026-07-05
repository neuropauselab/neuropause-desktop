import { describe, expect, it } from 'vitest';
import {
  composeSystemHealth,
  levelFromDiagnostic,
  worstLevel,
  type SystemHealthInputs,
} from '@neuropause/shared';

function inputs(over: Partial<SystemHealthInputs> = {}): SystemHealthInputs {
  return {
    nowMs: Date.parse('2026-01-10T00:00:00.000Z'),
    uptimeMs: 60_000,
    platform: {
      overall: 'ok',
      eventsPerMinute: 12,
      bufferedEvents: 0,
      avgDispatchMs: 2,
      droppedEvents: 0,
    },
    automation: { completed: 5, failed: 0, paused: 1, running: 0 },
    voice: 'idle',
    backendConnected: true,
    ...over,
  };
}

describe('levelFromDiagnostic', () => {
  it('maps diagnostic statuses to health levels', () => {
    expect(levelFromDiagnostic('ok')).toBe('healthy');
    expect(levelFromDiagnostic('degraded')).toBe('degraded');
    expect(levelFromDiagnostic('down')).toBe('critical');
    expect(levelFromDiagnostic('unknown')).toBe('unknown');
  });
});

describe('worstLevel', () => {
  it('returns the lower-scoring level', () => {
    expect(worstLevel('healthy', 'critical')).toBe('critical');
    expect(worstLevel('degraded', 'healthy')).toBe('degraded');
    expect(worstLevel('offline', 'critical')).toBe('offline');
  });
});

describe('composeSystemHealth (V5.0)', () => {
  it('reports a healthy, high-score system when all signals are good', () => {
    const s = composeSystemHealth(inputs());
    expect(s.level).toBe('healthy');
    expect(s.score).toBe(100);
    expect(s.subsystems).toHaveLength(5);
    expect(s.throughput.eventsPerMinute).toBe(12);
  });

  it('drops to critical when the backend is disconnected', () => {
    const s = composeSystemHealth(inputs({ backendConnected: false }));
    expect(s.level).toBe('critical');
    expect(s.score).toBeLessThan(100);
    const backend = s.subsystems.find((x) => x.id === 'backend');
    expect(backend?.level).toBe('critical');
    expect(backend?.detail).toBe('Disconnected');
  });

  it('marks automation degraded on partial failures', () => {
    const s = composeSystemHealth(
      inputs({ automation: { completed: 3, failed: 2, paused: 0, running: 0 } }),
    );
    const auto = s.subsystems.find((x) => x.id === 'automation');
    expect(auto?.level).toBe('degraded');
    expect(auto?.detail).toContain('2 failed');
  });

  it('marks automation critical when every run failed', () => {
    const s = composeSystemHealth(
      inputs({ automation: { completed: 0, failed: 4, paused: 0, running: 0 } }),
    );
    expect(s.subsystems.find((x) => x.id === 'automation')?.level).toBe('critical');
  });

  it('reflects voice offline vs recovering', () => {
    expect(
      composeSystemHealth(inputs({ voice: 'disconnected' })).subsystems.find(
        (x) => x.id === 'voice',
      )?.level,
    ).toBe('offline');
    expect(
      composeSystemHealth(inputs({ voice: 'recovering' })).subsystems.find((x) => x.id === 'voice')
        ?.level,
    ).toBe('degraded');
  });

  it('carries uptime and automation rollup through', () => {
    const s = composeSystemHealth(inputs({ uptimeMs: 123_456 }));
    expect(s.uptimeMs).toBe(123_456);
    expect(s.automation.completed).toBe(5);
  });
});
