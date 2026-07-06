import { describe, expect, it } from 'vitest';
import {
  composeSystemHealth,
  levelFromDiagnostic,
  voiceStateToRuntimeState,
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
    telemetry: {
      cpuPercent: 12,
      memoryUsedMb: 180,
      memoryTotalMb: 400,
      processUptimeMs: 60_000,
      backendLatencyMs: 20,
      backendState: 'connected',
    },
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
    const s = composeSystemHealth(
      inputs({
        telemetry: {
          cpuPercent: 5,
          memoryUsedMb: 100,
          memoryTotalMb: 400,
          processUptimeMs: 1000,
          backendLatencyMs: null,
          backendState: 'disconnected',
        },
      }),
    );
    expect(s.level).toBe('critical');
    expect(s.score).toBeLessThan(100);
    const backend = s.subsystems.find((x) => x.id === 'backend');
    expect(backend?.level).toBe('critical');
  });

  it('shows backend recovering as degraded', () => {
    const s = composeSystemHealth(
      inputs({
        telemetry: {
          cpuPercent: 5,
          memoryUsedMb: 100,
          memoryTotalMb: 400,
          processUptimeMs: 1000,
          backendLatencyMs: null,
          backendState: 'recovering',
        },
      }),
    );
    expect(s.subsystems.find((x) => x.id === 'backend')?.level).toBe('degraded');
  });

  it('degrades runtime under memory pressure', () => {
    const s = composeSystemHealth(
      inputs({
        telemetry: {
          cpuPercent: 5,
          memoryUsedMb: 380,
          memoryTotalMb: 400,
          processUptimeMs: 1000,
          backendLatencyMs: 10,
          backendState: 'connected',
        },
      }),
    );
    // 95% memory → runtime critical.
    expect(s.subsystems.find((x) => x.id === 'runtime')?.level).toBe('critical');
  });

  it('carries real telemetry through to the snapshot', () => {
    const s = composeSystemHealth(inputs());
    expect(s.telemetry.cpuPercent).toBe(12);
    expect(s.telemetry.memoryUsedMb).toBe(180);
    expect(s.telemetry.backendLatencyMs).toBe(20);
    expect(s.subsystems.find((x) => x.id === 'backend')?.detail).toBe('20ms');
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

describe('voiceStateToRuntimeState (V5.2)', () => {
  it('collapses fine-grained session states to runtime states', () => {
    expect(voiceStateToRuntimeState('wake')).toBe('listening');
    expect(voiceStateToRuntimeState('listening')).toBe('listening');
    expect(voiceStateToRuntimeState('recognizing')).toBe('listening');
    expect(voiceStateToRuntimeState('thinking')).toBe('thinking');
    expect(voiceStateToRuntimeState('waiting')).toBe('thinking');
    expect(voiceStateToRuntimeState('speaking')).toBe('speaking');
    expect(voiceStateToRuntimeState('error')).toBe('disconnected');
    expect(voiceStateToRuntimeState('idle')).toBe('idle');
    expect(voiceStateToRuntimeState('muted')).toBe('idle');
    expect(voiceStateToRuntimeState('completed')).toBe('idle');
  });
});

describe('composeSystemHealth — license subsystem (V6.1)', () => {
  it('omits the license subsystem entirely when no signal is reported', () => {
    const s = composeSystemHealth(inputs());
    expect(s.subsystems.find((x) => x.id === 'license')).toBeUndefined();
  });

  it('reports a valid license as healthy', () => {
    const s = composeSystemHealth(inputs({ license: { state: 'valid', graceDaysRemaining: 0 } }));
    const lic = s.subsystems.find((x) => x.id === 'license');
    expect(lic?.level).toBe('healthy');
  });

  it('reports a grace license as degraded with days remaining', () => {
    const s = composeSystemHealth(inputs({ license: { state: 'grace', graceDaysRemaining: 3 } }));
    const lic = s.subsystems.find((x) => x.id === 'license');
    expect(lic?.level).toBe('degraded');
    expect(lic?.detail).toContain('3');
  });

  it('reports an invalid license as critical and drags overall level', () => {
    const s = composeSystemHealth(inputs({ license: { state: 'invalid', graceDaysRemaining: 0 } }));
    const lic = s.subsystems.find((x) => x.id === 'license');
    expect(lic?.level).toBe('critical');
    expect(s.level).toBe('critical');
  });
});
