/**
 * The process-wide Pricing Rules module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path), mirroring the
 * `*Instance.ts` pattern used across main. The Quotes instance injects this
 * store to price against the rule book.
 */
import { app } from 'electron';
import { PRICING_RULES_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createPricingRuleModule } from './pricingRuleModule';

export const pricingRuleModule = createPricingRuleModule(
  enterpriseModuleStorePath(app.getPath('userData'), PRICING_RULES_MODULE_ID),
);
