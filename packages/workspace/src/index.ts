/**
 * @neuropause/workspace — the Enterprise Workspace & Digital Workforce Platform
 * (NCEA 10.5). The enterprise operating model built ON the Enterprise Runtime,
 * AI Runtime, and Connector Platform.
 *
 * Organizations, teams, workspaces, and projects are first-class entities. AI
 * employees and human users are the SAME principal model and operate in the same
 * governed workspace. Tasks, knowledge, collaboration, approvals, and connector
 * events all flow through the runtime's SINGLE event bus, audit chain, timeline,
 * and scheduler. No duplicate infrastructure; no duplicate identity or permission
 * system; nothing bypasses governance.
 *
 * STATUS: PREVIEW foundation. Pure, in-memory. Semantic search, live connector
 * bindings, and real AI provider calls require external services + credentials
 * and are NOT included here — they are deterministic mocks behind the same
 * interfaces.
 */
export * from './constants';
export * from './governance';
export * from './organization';
export * from './workspaceRegistry';
export * from './project';
export * from './identity';
export * from './workforce';
export * from './tasks';
export * from './inbox';
export * from './knowledge';
export * from './collaboration';
export * from './dashboard';
export * from './platform';
