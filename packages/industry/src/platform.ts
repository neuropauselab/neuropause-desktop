/**
 * Industry Solutions composition root. `createIndustryPlatform(runtime, …)` assembles the Wave 9
 * industry layer on the EXISTING platform: it reuses the one runtime audit chain + event bus
 * (industry governance), the Wave 8 business platform (domain reuse for every vertical, the AI
 * copilot, and KPI data), and — when provided — the Wave 5 execution platform (reused connector
 * count). It preloads the 20 built-in vertical packs and exposes the industry API surface, the
 * evidence matrix, and readiness. No core business logic is duplicated.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { BusinessPlatform } from '@neuropause/business';
import type { ExecutionPlatform } from '@neuropause/execution';
import { INDUSTRY_VERSION } from './constants';
import { INDUSTRY_MATRIX, industryReadiness, type CapabilityEvidence, type IndustryReadiness } from './evidence';
import { IndustryGovernance } from './governance';
import { IndustrySDK } from './sdk';
import { ConfigurationEngine } from './configuration';
import { LowCodePlatform } from './lowcode';
import { IndustryCopilots } from './copilots';
import { CompliancePackLibrary } from './compliancePacks';
import { ConnectorMarketplace } from './connectors';
import { IndustryAnalytics } from './analytics';
import { allIndustrySolutions } from './industries';
import type { IndustrySolution } from './types';

export interface IndustryPlatformOptions {
  clock?: Clock;
  business?: BusinessPlatform;
  execution?: ExecutionPlatform;
}

export interface IndustryPlatform {
  version: string;
  sdk(): IndustrySDK;
  configuration(): ConfigurationEngine;
  lowcode(): LowCodePlatform;
  copilots(): IndustryCopilots;
  compliancePacks(): CompliancePackLibrary;
  connectors(): ConnectorMarketplace;
  analytics(): IndustryAnalytics;
  industries(): IndustrySolution[];
  governance(): IndustryGovernance;
  reusedConnectorCount(): number;
  matrix(): CapabilityEvidence[];
  readiness(): IndustryReadiness;
}

export function createIndustryPlatform(runtime: EnterpriseRuntime, options: IndustryPlatformOptions = {}): IndustryPlatform {
  const clock = options.clock ?? systemClock;
  const governance = new IndustryGovernance(runtime, clock);
  const sdk = new IndustrySDK(clock, governance);
  const configuration = new ConfigurationEngine(clock, governance);
  const lowcode = new LowCodePlatform(governance);
  const copilots = new IndustryCopilots(sdk, options.business);
  const compliancePacks = new CompliancePackLibrary(governance);
  const connectors = new ConnectorMarketplace(governance);
  const analytics = new IndustryAnalytics(sdk, options.business);

  // preload the 20 built-in vertical packs
  for (const solution of allIndustrySolutions()) sdk.seed(solution);

  return {
    version: INDUSTRY_VERSION,
    sdk: () => sdk,
    configuration: () => configuration,
    lowcode: () => lowcode,
    copilots: () => copilots,
    compliancePacks: () => compliancePacks,
    connectors: () => connectors,
    analytics: () => analytics,
    industries: () => sdk.list(),
    governance: () => governance,
    reusedConnectorCount: () => options.execution?.connectors().count() ?? 0,
    matrix: () => INDUSTRY_MATRIX,
    readiness: () => industryReadiness(),
  };
}
