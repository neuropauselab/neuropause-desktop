/**
 * Wire framing (M1-02). Everything that travels INSIDE a sealed envelope:
 * requests, the ok/error response union, and realtime event frames. The
 * protocol layer is deliberately op-agnostic — route semantics (which ops
 * exist, their params, their RBAC) live in the desktop gateway's route table
 * (M1-03/04); this file only fixes the shapes both ends parse.
 */
import { z } from 'zod';
import { COMPANION_ERROR_CODES, type CompanionErrorCode } from './errors';

export const CompanionRequestSchema = z
  .object({
    id: z.string().min(1).max(64),
    op: z.string().min(1).max(80),
    params: z.unknown().optional(),
  })
  .strict();

export type CompanionRequest = z.infer<typeof CompanionRequestSchema>;

export const CompanionErrorSchema = z
  .object({
    code: z.enum(COMPANION_ERROR_CODES),
    message: z.string().min(1),
  })
  .strict();

export const CompanionResponseSchema = z.discriminatedUnion('ok', [
  z.object({ id: z.string().min(1), ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ id: z.string().min(1), ok: z.literal(false), error: CompanionErrorSchema }).strict(),
]);

export type CompanionResponse = z.infer<typeof CompanionResponseSchema>;

/** Realtime frame pushed desktop → phone over the sealed WS channel. */
export const CompanionEventFrameSchema = z
  .object({
    kind: z.literal('event'),
    /** Platform event type (e.g. `enterprise.record.updated`). */
    type: z.string().min(1),
    at: z.string().min(1),
    data: z.unknown(),
  })
  .strict();

export type CompanionEventFrame = z.infer<typeof CompanionEventFrameSchema>;

export function okResponse(id: string, result: unknown): CompanionResponse {
  return { id, ok: true, result };
}

export function errResponse(
  id: string,
  code: CompanionErrorCode,
  message: string,
): CompanionResponse {
  return { id, ok: false, error: { code, message } };
}
