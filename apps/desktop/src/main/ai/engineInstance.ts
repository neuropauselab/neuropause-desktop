/**
 * The single AI Engine instance for the app, built once from the configured
 * provider (see provider.ts / NEUROPAUSE_LLM_PROVIDER). Sharing one instance means
 * the audit log and token/cost tracking are unified across every consumer —
 * Engineering AI today; Founder AI and the Mission Brief narrative next.
 */
import { AiEngine } from './aiEngine';
import { createModelRouter } from './provider';

export const aiEngine = new AiEngine({ router: createModelRouter() });
