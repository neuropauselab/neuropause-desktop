/**
 * Error-report core — the DETERMINISTIC, redaction-safe assembly of a copyable diagnostic report for the
 * recoverable workspace error boundaries. Pure (no I/O, no clock read): the renderer boundary gathers the
 * real crash (message, stack, component stack) plus real app info and passes them in; this normalizes,
 * redacts anything user-identifying (home paths, secret-keyword values), and formats a clean support text.
 * Reused verbatim by the renderer's "Copy Details" / "Report Error" actions and by the tests.
 */

/** Friendly workspace labels (section id → human name) for the recovery UI + report header. */
const WORKSPACE_LABELS: Record<string, string> = {
  enterprise: 'Enterprise',
  operations: 'Operations',
  workforce: 'AI Workforce',
  automations: 'Automation',
  analytics: 'Analytics',
  memory: 'Knowledge & Memory',
  organization: 'Organization',
  cloud: 'Cloud',
  federation: 'Federation',
  ecosystem: 'Ecosystem',
  developer: 'Developer',
  store: 'Store',
  home: 'Home',
  workspace: 'Workspace',
  connectors: 'Connectors',
  settings: 'Settings',
  notifications: 'Notifications',
  welcome: 'Welcome',
};

export function workspaceLabel(sectionId: string): string {
  return WORKSPACE_LABELS[sectionId] ?? (sectionId ? sectionId.charAt(0).toUpperCase() + sectionId.slice(1) : 'Workspace');
}

/** Strip user-identifying paths and secret-keyword values from free text. Deterministic. */
export function redactSensitive(text: string): string {
  if (!text) return '';
  return text
    .replace(/\/Users\/[^/\s]+/g, '/Users/<user>')
    .replace(/\/home\/[^/\s]+/g, '/home/<user>')
    .replace(/[A-Za-z]:\\Users\\[^\\/\s]+/g, 'C:\\Users\\<user>')
    .replace(/\b(token|secret|password|passwd|api[_-]?key|authorization|bearer)\b(\s*[=:]\s*)"?([^\s"']+)"?/gi, '$1$2<redacted>');
}

export interface ErrorReportInput {
  /** The section/workspace id the crash occurred in. */
  workspace: string;
  message: string;
  stack?: string;
  componentStack?: string;
  appVersion?: string;
  platform?: string;
  /** ISO timestamp — injected (never read from a clock here) so the report is deterministic. */
  timestampIso: string;
  url?: string;
}

export interface ErrorReport {
  workspace: string;
  workspaceName: string;
  message: string;
  stack: string;
  componentStack: string;
  appVersion: string;
  platform: string;
  timestampIso: string;
  url: string;
}

/** Assemble a normalized, redacted error report from the real crash + environment. Pure. */
export function buildErrorReport(input: ErrorReportInput): ErrorReport {
  return {
    workspace: input.workspace,
    workspaceName: workspaceLabel(input.workspace),
    message: redactSensitive((input.message || 'Unknown error').trim()),
    stack: redactSensitive((input.stack ?? '').trim()),
    componentStack: redactSensitive((input.componentStack ?? '').trim()),
    appVersion: (input.appVersion ?? '').trim(),
    platform: (input.platform ?? '').trim(),
    timestampIso: input.timestampIso,
    url: redactSensitive((input.url ?? '').trim()),
  };
}

/** Render a copyable, support-ready plain-text report. Deterministic. */
export function formatErrorReport(report: ErrorReport): string {
  const lines = [
    'NeuroPause — workspace error report',
    `Workspace: ${report.workspaceName} (${report.workspace})`,
    `Time: ${report.timestampIso}`,
    `App: ${report.appVersion || 'unknown'} · ${report.platform || 'unknown'}`,
    report.url ? `URL: ${report.url}` : '',
    '',
    `Error: ${report.message}`,
    report.stack ? `\nStack trace:\n${report.stack}` : '',
    report.componentStack ? `\nComponent stack:\n${report.componentStack}` : '',
  ];
  return lines.filter((l) => l !== '').join('\n');
}
