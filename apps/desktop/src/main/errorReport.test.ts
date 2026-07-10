import { describe, expect, it } from 'vitest';
import {
  buildErrorReport,
  formatErrorReport,
  redactSensitive,
  workspaceLabel,
  type ErrorReportInput,
} from '@neuropause/shared';

const T = '2026-07-10T00:00:00.000Z';

describe('errorReport — redaction', () => {
  it('strips home paths and secret-keyword values, leaves the rest intact', () => {
    expect(redactSensitive('at /Users/saurabh/app/main.js:10')).toBe('at /Users/<user>/app/main.js:10');
    expect(redactSensitive('/home/claude/np/index.ts')).toBe('/home/<user>/np/index.ts');
    expect(redactSensitive('C:\\Users\\Sam\\dist\\app.js')).toBe('C:\\Users\\<user>\\dist\\app.js');
    expect(redactSensitive('Authorization: Bearer abc.def.ghi')).toContain('<redacted>');
    expect(redactSensitive('token=sk_live_9910')).toBe('token=<redacted>');
    expect(redactSensitive('Cannot read property x of undefined')).toBe('Cannot read property x of undefined');
    expect(redactSensitive('')).toBe('');
  });
});

describe('errorReport — workspace labels', () => {
  it('maps known section ids and falls back to a capitalized id', () => {
    expect(workspaceLabel('enterprise')).toBe('Enterprise');
    expect(workspaceLabel('memory')).toBe('Knowledge & Memory');
    expect(workspaceLabel('workforce')).toBe('AI Workforce');
    expect(workspaceLabel('somethingnew')).toBe('Somethingnew');
    expect(workspaceLabel('')).toBe('Workspace');
  });
});

describe('errorReport — build + format (deterministic)', () => {
  const input: ErrorReportInput = {
    workspace: 'enterprise',
    message: 'Boom in /Users/dev/x',
    stack: 'Error: Boom\n    at fn (/Users/dev/app.js:5:1)',
    componentStack: '\n    at TrustCenterPanel',
    appVersion: '1.0.0-rc.1',
    platform: 'darwin',
    timestampIso: T,
    url: 'app://index.html',
  };

  it('normalizes, redacts, and labels', () => {
    const r = buildErrorReport(input);
    expect(r.workspace).toBe('enterprise');
    expect(r.workspaceName).toBe('Enterprise');
    expect(r.message).toBe('Boom in /Users/<user>/x');
    expect(r.stack).toContain('/Users/<user>/app.js');
    expect(r.componentStack).toContain('TrustCenterPanel');
    expect(r.appVersion).toBe('1.0.0-rc.1');
    expect(r.timestampIso).toBe(T);
  });

  it('formats a stable, copyable report and is deterministic', () => {
    const text = formatErrorReport(buildErrorReport(input));
    expect(text).toContain('NeuroPause — workspace error report');
    expect(text).toContain('Workspace: Enterprise (enterprise)');
    expect(text).toContain('App: 1.0.0-rc.1 · darwin');
    expect(text).toContain('Error: Boom in /Users/<user>/x');
    expect(text).toContain('Stack trace:');
    expect(text).toContain('Component stack:');
    expect(text).not.toContain('/Users/dev'); // never leaks the real home path
    // deterministic
    expect(formatErrorReport(buildErrorReport(input))).toBe(text);
  });

  it('omits empty sections and defaults unknown env safely', () => {
    const text = formatErrorReport(buildErrorReport({ workspace: 'trust', message: 'x', timestampIso: T }));
    expect(text).toContain('Workspace: Trust (trust)');
    expect(text).toContain('App: unknown · unknown');
    expect(text).not.toContain('Stack trace:');
    expect(text).not.toContain('Component stack:');
    expect(text).not.toContain('URL:');
  });
});
