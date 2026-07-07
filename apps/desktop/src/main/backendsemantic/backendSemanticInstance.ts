/**
 * Production binding for the backend semantic client (V8.2 Part 2). Kept apart
 * from backendSemanticClient.ts so the client stays singleton-free and unit-
 * testable (same split as memoryInstance.ts vs memoryStore.ts). Wires the real
 * authService token + config.backendUrl + global fetch into a SemanticSearchFn.
 */
import { config } from '../config';
import { authService } from '../auth/authService';
import { createBackendSemanticSearch } from './backendSemanticClient';
import type { SemanticSearchFn } from '../memory/memorySemanticRecall';

/**
 * The production semantic hit source. Inject into `memoryStore.configureSemantic(...)`
 * at startup so `recallSemantic` blends backend vector hits with local lexical hits.
 */
export const backendSemanticSearch: SemanticSearchFn = createBackendSemanticSearch({
  backendUrl: config.backendUrl,
  getValidAccessToken: () => authService.getValidAccessToken(),
  fetchFn: (url, init) => fetch(url, init),
});
