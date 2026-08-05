/**
 * @neuropause/intelligence — NEMS Wave 3 Enterprise Intelligence Platform. Composes the
 * existing platform (runtime audit chain + event bus, ai-runtime InferencePipeline +
 * governance + provider registry, security vault, persistence, connectors, integrations,
 * NEMS, connectivity) into an intelligence layer over REAL enterprise data: a unified
 * knowledge graph, persisted enterprise memory, a deterministic evidence-grounded
 * reasoning engine, role-parameterized executive copilots, an AI workspace, a briefing
 * engine, a unified timeline, intelligence services, model routing, search v2, and
 * governance.
 *
 * Every AI answer references evidence, carries confidence metadata, is audited on the one
 * chain, and never fabricates company information — the engine only reports what the data
 * contains. Graph / memory / reasoning / timeline / intelligence run LIVE over real NEMS +
 * connectivity data with deterministic logic; natural-language generation uses a
 * deterministic provider (tested) with live LLM inference (Claude/GPT/Gemini/Ollama/
 * Mistral/Qwen) adapter-verified and INFRA-PENDING on operator API keys — never fabricated.
 */
export * from './constants';
export * from './types';
export * from './evidence';
export * from './graph';
export * from './memory';
export * from './timeline';
export * from './reasoning';
export * from './ai';
export * from './governance';
export * from './engine';
export * from './intelligence';
export * from './searchv2';
export * from './copilots';
export * from './workspace';
export * from './briefings';
export * from './dashboards';
export * from './platform';
