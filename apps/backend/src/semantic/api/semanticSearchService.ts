/**
 * Authenticated semantic search — service core (V8.2 Part 1).
 *
 * Framework-free so the security logic is unit-testable without Express: it takes
 * the authenticated `userId` and the path `orgId`, verifies membership BEFORE any
 * vector work, then embeds the query and searches Qdrant scoped to that verified
 * org. The org fed to the vector filter is the one membership was checked against
 * — never a value the client could smuggle in the body.
 *
 * Reuses the increment-1 embedding provider and increment-2 Qdrant client via
 * narrow deps; the Express router is a thin wrapper that maps SemanticError onto
 * the app's HTTP error helpers.
 */
import type { Embedding } from '../embedding/embeddingTypes';
import type { VectorSearchResult } from '../qdrant/qdrantTypes';

export type SemanticErrorCode = 'not_member' | 'invalid_request' | 'embedding_failed' | 'search_failed';

export class SemanticError extends Error {
  constructor(
    readonly code: SemanticErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'SemanticError';
  }
}

export interface SemanticSearchDeps {
  embeddingProvider: { embed(text: string): Promise<Embedding> };
  vectorStore: { search(vector: Embedding, options: { orgId: string; topK: number }): Promise<VectorSearchResult[]> };
  /** Same membership check the license router uses; null ⇒ not a member. */
  getMemberRole: (orgId: string, userId: string) => Promise<string | null>;
}

export interface SemanticSearchInput {
  /** From the path (`/:orgId/...`), then membership-verified. */
  orgId: string;
  /** From the authenticated session (req.userId). */
  userId: string;
  text: string;
  limit?: number;
}

export interface SemanticHit {
  memoryId: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface SemanticSearchResult {
  orgId: string;
  hits: SemanticHit[];
}

const MAX_TEXT = 400;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function semanticSearchQuery(
  deps: SemanticSearchDeps,
  input: SemanticSearchInput,
): Promise<SemanticSearchResult> {
  // 1. Authorization FIRST — a non-member never reaches the embedder or Qdrant.
  const role = await deps.getMemberRole(input.orgId, input.userId);
  if (!role) {
    throw new SemanticError('not_member', 'You are not a member of this organization.');
  }

  // 2. Validate input.
  const text = input.text?.trim();
  if (!text) throw new SemanticError('invalid_request', 'Query text is required.');
  if (text.length > MAX_TEXT) {
    throw new SemanticError('invalid_request', `Query text exceeds ${MAX_TEXT} characters.`);
  }
  const limit = clampLimit(input.limit);

  // 3. Embed the query (structured error on provider failure).
  let vector: Embedding;
  try {
    vector = await deps.embeddingProvider.embed(text);
  } catch (err) {
    throw new SemanticError('embedding_failed', 'Failed to embed the query.', err);
  }

  // 4. Search Qdrant scoped to the VERIFIED org (the client enforces the orgId filter).
  let results: VectorSearchResult[];
  try {
    results = await deps.vectorStore.search(vector, { orgId: input.orgId, topK: limit });
  } catch (err) {
    throw new SemanticError('search_failed', 'Vector search failed.', err);
  }

  return {
    orgId: input.orgId,
    hits: results.map((r) => ({
      memoryId: typeof r.payload.memoryId === 'string' ? r.payload.memoryId : r.id,
      score: r.score,
      payload: r.payload,
    })),
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}
