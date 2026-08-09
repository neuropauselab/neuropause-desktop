/**
 * The single AI Engine instance for the app, built once from the configured
 * provider (see provider.ts / NEUROPAUSE_LLM_PROVIDER). Sharing one instance means
 * the audit log and token/cost tracking are unified across every consumer —
 * Engineering AI today; Founder AI and the Mission Brief narrative next.
 */
import { AiEngine } from './aiEngine';
import { createModelRouter } from './provider';
import { routingUsageStore } from './routingUsageInstance';

export const aiEngine = new AiEngine({
  router: createModelRouter(),
  // Every run measures where its processing ACTUALLY went (or 'none' for the
  // deterministic fallback). This is the only feed the AI Usage surface has.
  recordRoute: (location) => routingUsageStore.record(location),
});
