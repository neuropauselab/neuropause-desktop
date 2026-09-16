/**
 * The single AI Engine instance for the app, built once from the configured
 * provider (see provider.ts / NEUROPAUSE_LLM_PROVIDER). Sharing one instance means
 * the audit log and token/cost tracking are unified across every consumer —
 * Engineering AI today; Founder AI and the Mission Brief narrative next.
 */
import { AiEngine } from './aiEngine';
import { createBootRouter } from './provider';
import { routingUsageStore } from './routingUsageInstance';

export const aiEngine = new AiEngine({
  // P13C ROUND 35 — D-4: the boot router FAILS CLOSED (deterministic fallback,
  // nothing leaves the machine) until engineManager.init() swaps in the real
  // config/Vault/tenant-aware router. The old value here was a bare env-keyed
  // cloud client — policy-blind external routing during the boot window.
  router: createBootRouter(),
  // Every run measures where its processing ACTUALLY went (or 'none' for the
  // deterministic fallback). This is the only feed the AI Usage surface has.
  recordRoute: (location) => routingUsageStore.record(location),
});
