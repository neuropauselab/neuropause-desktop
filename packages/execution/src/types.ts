/**
 * Wave 5 core types — connector descriptors, execution requests, and the fully-governed
 * execution result (with evidence level, audit id, replay id). Evidence level is carried
 * on every result so the honesty classification is structural, not documentation.
 */
import type { AuthKind, RiskTier, ExecutionOutcome, ConnectorId } from './constants';

export type EvidenceLevel = 'live-verified' | 'adapter-verified' | 'infra-pending';

export interface OperationSpec {
  name: string;
  method: string;
  /** path template with `{param}` placeholders resolved from request.params. */
  path: string;
  riskTier?: RiskTier;
  /** true for mutating operations (POST/PUT/PATCH/DELETE) — subject to stricter policy. */
  mutating?: boolean;
}

export interface ConnectorDescriptor {
  id: ConnectorId | string;
  name: string;
  category: string;
  auth: AuthKind;
  baseUrl: string;
  operations: OperationSpec[];
  /** adapter-verified for SaaS (simulated responses); live-verified for generic REST/GraphQL. */
  evidence: EvidenceLevel;
}

export interface ExecutionRequest {
  tenantId: string;
  actor: string;
  connectorId: string;
  operation: string;
  /** path/query params. */
  params?: Record<string, string | number | boolean>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  headers?: Record<string, string>;
  /** explicit bearer token / api key (else resolved from the vault). */
  token?: string;
  /** absolute base override (used for generic REST/GraphQL + local-server live tests). */
  baseUrl?: string;
  aiInitiated?: boolean;
  approved?: boolean;
}

export interface ExecutionResult {
  id: string;
  tenantId: string;
  actor: string;
  connectorId: string;
  operation: string;
  outcome: ExecutionOutcome;
  status?: number;
  body?: unknown;
  latencyMs: number;
  attempts: number;
  auditId: string;
  replayId: string;
  evidence: EvidenceLevel;
  error?: string;
  at: number;
}
