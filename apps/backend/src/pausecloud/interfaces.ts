/**
 * PauseCloud — INTERFACE BOUNDARY ONLY. DESIGN_ONLY / NOT_IMPLEMENTED.
 *
 * These types define the governed evidence/storage plane's contract so that
 * future implementation cannot drift from the governance model. Nothing here
 * stores, deletes, or synchronizes anything. Rules encoded by shape:
 *  - object identity is a content digest; ownership lives ONLY in references
 *    (HASH EQUALITY != OWNERSHIP EQUALITY);
 *  - deletion is a request + human-reviewable decision, never an automatic GC
 *    (the b05e3300 loss is the standing counter-example);
 *  - every record separates existence / reference / retention / provenance /
 *    verification as distinct facts.
 */
export interface EvidenceObject {
  objectDigest: string; // sha256 of canonical content — identity, not ownership
  sizeBytes: number;
  mediaType: string;
  createdAt: string;
  verificationState: 'UNVERIFIED' | 'DIGEST_VERIFIED';
}

export interface OwnerReference {
  ownerId: string;
  ownerKind: 'user' | 'organization' | 'system';
}

export interface EvidenceReference {
  referenceId: string;
  objectDigest: string;
  owner: OwnerReference;
  purpose: string;
  retentionPolicyId: string | null;
  legalHold: boolean;
  evidenceStatus: 'LOAD_BEARING' | 'DERIVED' | 'CACHE';
  createdAt: string;
}

export interface ProvenanceRecord {
  recordId: string;
  objectDigest: string;
  parentDigests: string[];
  producedBy: string;
  producedAt: string;
}

export interface RetentionPolicy {
  policyId: string;
  name: string;
  minimumRetention: string; // ISO-8601 duration
  state: 'DRAFT' | 'APPROVED_BY_HUMAN' | 'EFFECTIVE' | 'RETIRED';
}

export interface DeletionRequest {
  requestId: string;
  referenceId: string;
  requestedBy: OwnerReference;
  reason: string;
  requestedAt: string;
}

export interface DeletionDecision {
  requestId: string;
  decidedByHumanId: string; // machine ids are invalid here by contract
  decision: 'APPROVED' | 'REJECTED';
  checkedReferences: boolean;
  checkedRetention: boolean;
  checkedLegalHold: boolean;
  checkedEvidenceStatus: boolean;
  decidedAt: string;
}

export interface StorageReceipt {
  objectDigest: string;
  provider: 'LOCAL_DEVELOPMENT' | 'OBJECT_STORAGE' | 'S3_COMPATIBLE' | 'CLOUD_R2';
  storedAt: string;
  tier: 'HOT' | 'WARM' | 'COLD';
}

/** Provider abstraction — future adapters implement this; none exist yet. */
export interface PauseCloudStorageProvider {
  put(content: Uint8Array, mediaType: string): Promise<StorageReceipt>;
  get(objectDigest: string): Promise<Uint8Array | null>;
  // Deliberately NO delete(): destructive deletion requires the DeletionDecision
  // pathway and is out of scope until a retention policy is EFFECTIVE.
}
