/**
 * @neuropause/workforce — NEMS Wave 11 Enterprise AI Workforce Platform. Composes Waves 1-10
 * (unchanged) into a governed AI-native workforce: a workforce runtime and agent registry,
 * department/business/industry AI workers, multi-agent collaboration, a planning engine, a
 * reasoning engine, a governed tool runtime, enterprise memory, human collaboration, an AI
 * organization, governance-restricted autonomous workflows, executive AI, an AI marketplace, and a
 * worker SDK. AI operates THROUGH the existing runtime, audit chain, HITL, execution engine, and
 * business platform — it never replaces governance.
 *
 * Workforce runtime/registry/workers/collaboration/planning/reasoning/tools/memory/organization/
 * workflows/executive/marketplace/SDK/governance are LIVE-VERIFIED in-process; external LLM/voice/
 * translation/OCR providers are ADAPTER-VERIFIED until configured; organization tasks/business
 * work/AI conversations/enterprise knowledge are BUSINESS-DATA-PENDING (registries start empty;
 * never fabricated); and autonomous financial approval, payroll, banking, tax filing, clinical
 * decisions, and legal decisions are REGULATED-EXTERNAL — represented only, never executed
 * autonomously. Reasoning collects evidence from real sources and never fabricates it; every AI
 * action is audited on the one chain with user/org/worker/evidence/reasoning/approval/replay id.
 */
export * from './constants';
export * from './types';
export * from './evidence';
export * from './governance';
export * from './adapters';
export * from './registry';
export * from './workers';
export * from './memory';
export * from './collaboration';
export * from './planning';
export * from './reasoning';
export * from './tools';
export * from './humanCollab';
export * from './organization';
export * from './workflows';
export * from './executive';
export * from './marketplace';
export * from './sdk';
export * from './platform';
