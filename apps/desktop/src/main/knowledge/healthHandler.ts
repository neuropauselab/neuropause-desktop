/**
 * Knowledge health handler (V8.3 inc8). Framework-free wrapper that runs
 * knowledgeHealth over the local memory set. Reuses the verified derivation.
 */
import type { MemoryItem } from '@neuropause/shared';
import { knowledgeHealth, type KnowledgeHealth } from './knowledgeHealth';

export interface HealthHandlerDeps {
  listItems: () => MemoryItem[];
}

export function handleKnowledgeHealth(deps: HealthHandlerDeps): KnowledgeHealth {
  return knowledgeHealth(deps.listItems());
}
