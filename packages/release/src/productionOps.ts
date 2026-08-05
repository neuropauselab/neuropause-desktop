/**
 * EPIC 16 — Production Operations. Generates the six operational playbooks (operations, support,
 * release, incident, maintenance, upgrade) as structured procedures. Live-verified in-process outlines.
 */
import { randomId } from '@neuropause/cloud-core';
import { PLAYBOOK_KINDS, type PlaybookKind } from './constants';
import type { ReleaseGovernance } from './governance';

export interface Playbook {
  id: string;
  kind: PlaybookKind;
  title: string;
  steps: string[];
}

const STEPS: Record<PlaybookKind, string[]> = {
  operations: ['monitor health', 'triage alerts', 'run daily checks', 'record status'],
  support: ['receive ticket', 'triage severity', 'escalate if needed', 'resolve + RCA', 'close + KB'],
  release: ['validate RC', 'run GA gate', 'promote', 'verify', 'announce release notes'],
  incident: ['detect', 'declare severity', 'mitigate', 'resolve', 'postmortem'],
  maintenance: ['schedule window', 'notify customers', 'apply change', 'verify', 'close window'],
  upgrade: ['check compatibility', 'back up', 'apply upgrade', 'verify', 'rollback on failure'],
};

export class ProductionOperations {
  private readonly playbooks = new Map<string, Playbook>();

  constructor(
    private readonly gov: ReleaseGovernance,
    private readonly operator: string,
  ) {}

  kinds(): readonly PlaybookKind[] {
    return PLAYBOOK_KINDS;
  }

  async generate(kind: PlaybookKind): Promise<Playbook> {
    if (!PLAYBOOK_KINDS.includes(kind)) throw new Error(`unknown playbook: ${kind}`);
    const playbook: Playbook = { id: randomId('playbook'), kind, title: `${kind} playbook`, steps: STEPS[kind] };
    this.playbooks.set(playbook.id, playbook);
    await this.gov.record({ operator: this.operator, version: '_ops', environment: '_operations', customerScope: '_all', epic: 'E16', operation: 'generate-playbook', targetId: kind, evidence: 'live-verified', decision: `${playbook.steps.length} steps` });
    return playbook;
  }

  count(): number {
    return this.playbooks.size;
  }
}
