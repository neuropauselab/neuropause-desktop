/**
 * Shared response envelope + trace ids (NCEA 10.2B).
 *
 * AVAILABLE to backend routes; deliberately NOT retrofitted onto existing
 * endpoints — changing their response shapes would break the SDK and clients
 * (Phase 9: no schema breakage). New or opt-in routes use these helpers to emit
 * the unified `ApiResponse<T>` with a trace id (Principle 7).
 */
import type { ApiResponse } from '@neuropause/shared-cloud';
import { randomId } from '@neuropause/cloud-core';

export function newTraceId(): string {
  return randomId('trace');
}

export function apiOk<T>(data: T, traceId: string = newTraceId()): ApiResponse<T> {
  return { ok: true, data, traceId };
}

export function apiFail(code: string, message: string, traceId: string = newTraceId()): ApiResponse<never> {
  return { ok: false, error: { code, message }, traceId };
}
