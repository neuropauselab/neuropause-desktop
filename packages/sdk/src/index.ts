/**
 * @neuropause/sdk — the official client for the NeuroPause Ecosystem Platform.
 *
 *   import { NeuroPauseClient, defineWorker } from '@neuropause/sdk';
 *   const np = new NeuroPauseClient({ apiKey: process.env.NEUROPAUSE_API_KEY });
 *   const listings = await np.marketplace.list();
 */
export * from './transport';
export * from './resources';
export * from './client';
export * from './builders';
export { signWebhook, verifyWebhook, parseWebhook } from './webhooks';
export type { WebhookEvent } from './webhooks';

// Re-export the platform types so SDK users get them without importing shared.
export type {
  ApiKey,
  ApiScope,
  ApiVersion,
  ApiVersionInfo,
  BillingSummary,
  DeveloperAccount,
  GatewayDecision,
  ListingDetail,
  ListingKind,
  ListingManifest,
  ListingVersion,
  MarketplaceListing,
  MarketplaceStats,
  Plan,
  PlanTier,
  PricingModel,
  ReviewDecision,
  SdkArtifact,
} from '@neuropause/shared';
