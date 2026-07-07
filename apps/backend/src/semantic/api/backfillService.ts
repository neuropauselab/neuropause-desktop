/**
 * Memory backfill service (V8.2 Part 2 inc3). Desktop-driven: the desktop holds
 * memory content (local-first) and posts batches here; the backend embeds + writes
 * org-scoped vectors. Content is embedded in-flight to a vector and never persisted
 * backend-side.
 *
 * Framework-free so the authorization + mapping is unit-testable. Membership is
 * checked BEFORE any embedding (same gate as search), then the batch is handed to
 * the Part 1 `runEmbeddingPipeline` — which already enforces content-hash
 * idempotency, resumability, and per-item isolation. No embed/upsert logic is
 * reimplemented here; org isolation holds because every source carries the
 * membership-verified path org and the Qdrant client forces the orgId filter.
 */
import {
  runEmbeddingPipeline,
  type EmbeddingStateRepository,
  type MemorySource,
  type PipelineResult,
} from '../pipeline/embeddingPipeline';
import type { Embedding, EmbeddingVersion } from '../embedding/embeddingTypes';
import type { VectorRecord } from '../qdrant/qdrantTypes';

export type BackfillErrorCode = 'not_member' | 'invalid_request';

export class BackfillError extends Error {
  constructor(
    readonly code: BackfillErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BackfillError';
  }
}

export interface BackfillDeps {
  embeddingProvider: { version: EmbeddingVersion; embed(text: string): Promise<Embedding> };
  vectorStore: { batchUpsert(records: VectorRecord[]): Promise<void> };
  stateRepo: EmbeddingStateRepository;
  /** Same membership check the search + license routers use; null ⇒ not a member. */
  getMemberRole: (orgId: string, userId: string) => Promise<string | null>;
}

export interface BackfillInput {
  /** From the path, then membership-verified. */
  orgId: string;
  /** From the authenticated session. */
  userId: string;
  memories: Array<{ memoryId: string; content: string }>;
}

const MAX_BATCH = 500;

export async function backfillOrgMemories(deps: BackfillDeps, input: BackfillInput): Promise<PipelineResult> {
  // 1. Authorization FIRST — a non-member never reaches the embedder or Qdrant.
  const role = await deps.getMemberRole(input.orgId, input.userId);
  if (!role) {
    throw new BackfillError('not_member', 'You are not a member of this organization.');
  }

  // 2. Validate.
  if (!Array.isArray(input.memories) || input.memories.length === 0) {
    throw new BackfillError('invalid_request', 'No memories provided.');
  }
  if (input.memories.length > MAX_BATCH) {
    throw new BackfillError('invalid_request', `Batch exceeds ${MAX_BATCH} memories.`);
  }

  // 3. Map to pipeline sources, stamping the VERIFIED org (never a client-supplied one).
  const sources: MemorySource[] = input.memories
    .filter((m) => m.memoryId && typeof m.content === 'string' && m.content.trim() !== '')
    .map((m) => ({ id: m.memoryId, orgId: input.orgId, content: m.content }));

  // 4. Reuse the Part 1 pipeline — idempotent, resumable, per-item isolated.
  return runEmbeddingPipeline(
    { embeddingProvider: deps.embeddingProvider, vectorStore: deps.vectorStore, stateRepo: deps.stateRepo },
    sources,
  );
}
