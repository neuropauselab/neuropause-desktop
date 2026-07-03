/**
 * AI Memory — persistent organizational memory.
 *
 * A memory item is a durable, searchable record of something worth remembering:
 * a decision, a conversation, a document, a task, a meeting, a piece of context,
 * or a relationship. Items come from two places, and we never blur them:
 *
 *   - **projected** — derived deterministically from the Unified Data Model, so
 *     the system "remembers" your connected work automatically. Each carries
 *     `evidence` back to the UDM record it came from.
 *   - **explicit** — authored in the app (a decision, a note, captured context)
 *     that has no connector source.
 *
 * Retrieval is semantic-ready: a swappable retriever (lexical TF-IDF today,
 * Qdrant later) ranks items by relevance. Nothing is fabricated — a projected
 * memory is a distilled pointer to real data, and an explicit memory is exactly
 * what was written.
 *
 * Types-only so the main process, renderer, and tests share them.
 */

export type MemoryKind =
  | 'decision'
  | 'conversation'
  | 'document'
  | 'task'
  | 'meeting'
  | 'context'
  | 'relationship'
  | 'note';

export const MEMORY_KINDS: readonly MemoryKind[] = [
  'decision',
  'conversation',
  'document',
  'task',
  'meeting',
  'context',
  'relationship',
  'note',
] as const;

/** Where a memory came from: projected from the UDM, or explicitly authored. */
export type MemoryOrigin = 'projected' | 'explicit';

export type MemoryMeta = Record<string, string | number | boolean | null>;

/** A reference back to the UDM record (or graph node) a memory is grounded in. */
export interface MemoryEvidence {
  kind: string;
  id: string;
}

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  origin: MemoryOrigin;
  title: string;
  /** The distilled, searchable memory text. */
  content: string;
  connectorId: string | null;
  /** Origin label: a connector id for projected memories, 'manual' for explicit. */
  source: string;
  /** UDM entity / graph node ids this memory concerns. */
  entityRefs: string[];
  tags: string[];
  /** When the underlying thing happened (ISO), for time filtering. */
  occurredAt: string | null;
  /** When it was remembered (ISO). */
  createdAt: string;
  updatedAt: string;
  evidence: MemoryEvidence | null;
  metadata: MemoryMeta;
}

/** Input for explicitly remembering something. */
export interface MemoryWriteInput {
  kind: MemoryKind;
  title: string;
  content: string;
  entityRefs?: string[];
  tags?: string[];
  occurredAt?: string | null;
  metadata?: MemoryMeta;
}

export interface MemoryRecallQuery {
  /** Free-text query for semantic-style ranking; omit to browse by filters. */
  text?: string;
  kinds?: MemoryKind[];
  /** Only memories concerning this entity / graph node id. */
  entityRef?: string;
  tag?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface MemoryHit {
  item: MemoryItem;
  /** Relevance in 0..1 (1 for pure filter/browse with no text query). */
  score: number;
}

export interface MemoryRecallResult {
  hits: MemoryHit[];
  total: number;
  /** Which retriever answered: 'lexical' now; 'qdrant' later. */
  retriever: string;
}

export interface MemoryCounts {
  total: number;
  byKind: Record<string, number>;
  byOrigin: Record<string, number>;
  lastBuiltAt: string | null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Executive Conversation Memory
 *
 * A layer on top of AI Memory: Founder AI classifies each executive exchange,
 * screens it for secrets, and (when worth keeping) persists it as an explicit
 * MemoryItem with the executive metadata encoded in `tags`/`metadata`. Nothing
 * here is a parallel store — these are the typed semantics over the same
 * memoryStore, so retrieval flows through the existing Context Builder path.
 * ────────────────────────────────────────────────────────────────────────── */

/** The kind of thing an executive memory captures. */
export type ExecutiveMemoryType = 'conversation' | 'decision' | 'action' | 'preference' | 'project';

/** Retention decision from the classifier. 'ignore' means: do not store. */
export type MemoryDecision = 'ignore' | 'temporary' | 'today' | 'project' | 'longterm';

/** Whether a decision-type memory is still open or has been resolved. */
export type ExecutiveMemoryStatus = 'open' | 'resolved';

/** Output of the deterministic memory classifier. */
export interface MemoryClassification {
  /** Retention bucket; 'ignore' short-circuits storage. */
  decision: MemoryDecision;
  type: ExecutiveMemoryType;
  /** 0..1 — how much this matters (by type). */
  importance: number;
  /** 0..1 — confidence in the classification itself. */
  confidence: number;
  /** Plain-language reason the classifier reached this decision. */
  reason: string;
}

/** Why the governance screen rejected a candidate memory. */
export type MemoryRejectionCategory =
  | 'password'
  | 'api-key'
  | 'token'
  | 'secret'
  | 'private-key'
  | 'financial-credential'
  | 'medical-information';

export interface MemoryRejection {
  category: MemoryRejectionCategory;
  /** Human-readable explanation shown to the founder. */
  detail: string;
}

export interface MemoryScreenResult {
  allowed: boolean;
  rejections: MemoryRejection[];
}

/** A decoded, UI-facing view of an executive memory (metadata unpacked). */
export interface ExecutiveMemoryView {
  id: string;
  type: ExecutiveMemoryType;
  /** Retention scope it was stored under (never 'ignore'). */
  scope: Exclude<MemoryDecision, 'ignore'>;
  title: string;
  content: string;
  importance: number;
  confidence: number;
  project: string | null;
  worker: string | null;
  connectorId: string | null;
  status: ExecutiveMemoryStatus;
  pinned: boolean;
  occurredAt: string | null;
  createdAt: string;
  /** ISO expiry for scoped memories; null = permanent. */
  expiresAt: string | null;
  sourceConversation: string | null;
  evidence: MemoryEvidence | null;
}

export type MemoryCaptureOutcome = 'stored' | 'ignored' | 'rejected';

export interface MemoryCaptureResult {
  outcome: MemoryCaptureOutcome;
  classification: MemoryClassification;
  /** Present when outcome === 'stored'. */
  memory: ExecutiveMemoryView | null;
  /** Present when outcome === 'rejected'. */
  rejections: MemoryRejection[];
}

/** Query for the Memory panel + Search Memory (keyword/project/date/worker/decision/connector). */
export interface ExecutiveMemoryQuery {
  text?: string;
  type?: ExecutiveMemoryType;
  project?: string;
  worker?: string;
  connectorId?: string;
  /** Only decision-type memories. */
  decisionsOnly?: boolean;
  /** Filter decisions by open/resolved. */
  status?: ExecutiveMemoryStatus;
  pinnedOnly?: boolean;
  since?: string;
  until?: string;
  limit?: number;
}

export type MemoryAuditAction =
  'created' | 'updated' | 'used' | 'forgotten' | 'rejected' | 'pinned';

export interface MemoryAuditEvent {
  id: string;
  action: MemoryAuditAction;
  /** The memory this concerns; null for a rejected capture (nothing was stored). */
  memoryId: string | null;
  at: string;
  /** Plain-language summary of what happened. */
  detail: string;
  /** Set on 'created'/'rejected' captures. */
  decision: MemoryDecision | null;
  /** Set on 'rejected' captures — the governance result. */
  rejections: MemoryRejection[];
}

/**
 * What Founder AI did with a single exchange, surfaced on the answer so the
 * founder can see it was remembered, ignored, or refused (and why).
 */
export interface FounderMemoryCapture {
  outcome: MemoryCaptureOutcome;
  /** The classified type (present even when the exchange was ignored). */
  type: ExecutiveMemoryType;
  /** Retention scope when stored; null when ignored or rejected. */
  scope: Exclude<MemoryDecision, 'ignore'> | null;
  /** The stored memory id when stored; null otherwise. */
  memoryId: string | null;
  /** Why it was refused, when the governance screen rejected it. */
  rejections: MemoryRejection[];
}

/** A page of memory audit events, newest-first (returned by the audit query). */
export interface MemoryAuditPage {
  entries: MemoryAuditEvent[];
  total: number;
}
