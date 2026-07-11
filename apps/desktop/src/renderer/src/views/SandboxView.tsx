import { SandboxRoot } from '@renderer/sandbox/SandboxView';

/**
 * The AI Sandbox workspace (P4 — Validation Experience & Operationalization). Turns AI Sandbox
 * v1.0 (S1–S6) into a production-grade visual application: continuous validation, live execution,
 * AI QA, performance & security, regression, certification, artifacts, and history — all reading
 * the existing sandbox + validation channels. This wrapper preserves the export the shell loads.
 */
export function SandboxView(): JSX.Element {
  return <SandboxRoot />;
}
