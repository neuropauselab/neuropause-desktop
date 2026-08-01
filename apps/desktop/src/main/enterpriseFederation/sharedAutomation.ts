/**
 * Phase 6 Stage 11 — shared automation: the Stage 8 composition. Joins the
 * recorded workflow_template artifacts with the REAL Stage 8 playbooks (the
 * shareable template candidates) and the automation monitor's finding counts.
 * The platform records no per-share monitor attribution — the counts are
 * platform-wide and SAY so. Pure; reads injected.
 */
import type { EfedGap, EfedSharedAutomation, EfedUnavailable } from '@neuropause/shared';

export interface SharedAutomationInput {
  artifacts: { kind: string; name: string }[] | null;
  playbooks: { id: string; name: string; version: number }[] | null;
  apFindings: { severity: string }[] | null;
  failures: Record<string, string>;
}

export function buildSharedAutomation(input: SharedAutomationInput): EfedSharedAutomation {
  const unavailable: EfedUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));
  const gaps: EfedGap[] = [];
  const templates = (input.artifacts ?? []).filter((a) => a.kind === 'workflow_template');

  const playbookCandidates = (input.playbooks ?? []).map((p) => {
    const match = templates.find((t) => t.name.trim().toLowerCase() === p.name.trim().toLowerCase());
    return { id: p.id, name: p.name, version: p.version, nameMatchedArtifact: match ? match.name : null };
  });
  if (input.playbooks === null) gaps.push({ kind: 'mapping', subject: 'playbooks', detail: 'the Stage 8 playbook registry was unreadable this pass' });
  if (input.playbooks !== null && templates.length === 0) {
    gaps.push({ kind: 'linkage', subject: 'workflow_template', detail: 'no workflow_template artifact is recorded in the exchange' });
  }

  return {
    templatesPublished: input.artifacts === null ? 0 : templates.length,
    playbookCandidates,
    monitorFindings:
      input.apFindings === null
        ? null
        : {
            total: input.apFindings.length,
            criticalOrHigh: input.apFindings.filter((f) => f.severity === 'critical' || f.severity === 'high').length,
          },
    gaps,
    unavailable,
  };
}
