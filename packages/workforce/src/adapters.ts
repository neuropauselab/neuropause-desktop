/**
 * External AI provider adapters — LLM, voice, translation, and OCR. Each is a DESCRIPTOR that
 * stays ADAPTER-VERIFIED until configured; no external inference is ever called here. An agent's
 * reasoning in this package is deterministic, in-process, and grounded in real data — deep neural
 * generation is delegated to one of these adapters, represented but not executed.
 */
import { randomId } from '@neuropause/cloud-core';
import type { WorkforceGovernance } from './governance';
import type { EvidenceLevel } from './types';
import { AI_PROVIDER_CATALOG } from './constants';

export interface AiProviderDescriptor {
  id: string;
  system: string;
  category: string;
  configured: boolean;
  evidence: EvidenceLevel;
  note: string;
}

export class AiProviderRegistry {
  private readonly providers = new Map<string, AiProviderDescriptor>();

  constructor(private readonly governance: WorkforceGovernance) {}

  async register(system: string, category: string): Promise<AiProviderDescriptor> {
    const p: AiProviderDescriptor = { id: randomId('aip'), system, category, configured: false, evidence: 'adapter-verified', note: `${system} (${category}) represented — adapter-verified until configured; no external inference is executed here` };
    this.providers.set(p.id, p);
    await this.governance.record({ user: 'system', org: '_platform', worker: 'system', operation: `adapter.register.${category}`, targetId: p.id, evidence: 'adapter-verified', reasoning: system });
    return p;
  }

  async seed(): Promise<void> {
    for (const entry of AI_PROVIDER_CATALOG) await this.register(entry.system, entry.category);
  }

  list(category?: string): AiProviderDescriptor[] {
    const all = [...this.providers.values()];
    return category ? all.filter((p) => p.category === category) : all;
  }
  systems(): string[] {
    return [...this.providers.values()].map((p) => p.system);
  }
  count(): number {
    return this.providers.size;
  }
}
