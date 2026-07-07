/**
 * Semantic retriever (V6.9). Depends ONLY on the EmbeddingService and VectorStore
 * interfaces — never on a concrete provider or vector DB — so it's fully testable
 * with the in-memory store + a stub embedder, and unchanged when real Qdrant/OpenAI
 * implementations are dropped in. Output is `RetrievalHit[]`, which flows straight
 * into the existing hybrid merge (V6.7.1) and ranking engine (V6.7.0): those remain
 * the single ranking authority; this only produces the semantic candidate list.
 *
 *   query → embed (interface) → vector search (interface) → RetrievalHit[]
 *         → mergeRetrievalCandidates(lexical, semantic) → rankMemories → results
 */
import type { EmbeddingService } from './embedding';
import type { VectorStore } from './vectorStore';
import type { RetrievalHit } from './memoryHybridSearch';

export interface SemanticRetrieverDeps {
  embeddingService: Pick<EmbeddingService, 'embed'>;
  vectorStore: Pick<VectorStore, 'search'>;
}

export interface SemanticQuery {
  text: string;
  orgId: string;
  topK?: number;
}

/**
 * Embed the query and search the vector store, returning semantic hits scoped to
 * the org. Deleted vectors are already excluded by the store. Returns [] for empty
 * input rather than embedding whitespace.
 */
export async function semanticSearch(
  deps: SemanticRetrieverDeps,
  query: SemanticQuery,
): Promise<RetrievalHit[]> {
  if (!query.text.trim()) return [];
  const vector = await deps.embeddingService.embed(query.text);
  const results = await deps.vectorStore.search(vector, {
    orgId: query.orgId,
    topK: query.topK ?? 20,
  });
  return results.map((r) => ({ memoryId: r.id, score: r.score }));
}
