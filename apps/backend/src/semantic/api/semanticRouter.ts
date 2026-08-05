/**
 * Authenticated semantic search router (V8.2 Part 1). Thin Express wrapper over
 * `semanticSearchQuery` — mirrors the license router: mount behind `requireAuth`,
 * take `orgId` from the path, `userId` from `req.userId` (the session), validate
 * the body with zod, and map `SemanticError` onto the app's HTTP error helpers.
 *
 * Wiring (in app.ts), behind requireAuth so the session is present:
 *
 *   const embeddingProvider = createEmbeddingProvider(loadEmbeddingConfig(env), {
 *     fetchFn: (url, init) => fetch(url, init) as unknown as HttpResponse,
 *   });
 *   const vectorStore = new QdrantVectorStore(loadQdrantConfig(env), (u, i) => fetch(u, i) as never);
 *   const orgRepo = createPgOrgRepository(pool);
 *   app.use(
 *     '/memory/semantic',
 *     requireAuth,
 *     createSemanticRouter({ embeddingProvider, vectorStore, getMemberRole: orgRepo.getMemberRole }),
 *   );
 *
 * → POST /memory/semantic/:orgId/search  { text, limit? }
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AppError,
  badRequest,
  forbidden,
  serviceUnavailable,
  unauthorized,
} from '../../middleware/error';
import { semanticSearchQuery, SemanticError, type SemanticSearchDeps } from './semanticSearchService';

const SearchBody = z.object({
  text: z.string().trim().min(1).max(400),
  limit: z.number().int().min(1).max(100).optional(),
});

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const h =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

function actorId(req: Request): string {
  if (!req.userId) throw unauthorized('unauthorized', 'Authentication required.');
  return req.userId;
}

/**
 * Cooldown hint for a 503, in seconds. Deliberately the same number as the
 * desktop breaker's own cooldown (`DEFAULT_RESET_TIMEOUT_MS = 30_000`,
 * `apps/desktop/src/main/memory/retrievalHealth.ts:65`): a shorter hint would
 * invite retries the client's open circuit refuses anyway, and a longer one
 * would leave a recovered backend idle. They are one value for one reason, so
 * they are documented as a pair rather than tuned apart.
 */
export const SEMANTIC_RETRY_AFTER_SECONDS = 30;

/**
 * Did the layer that actually failed judge its own failure transient?
 *
 * `semanticSearchQuery` wraps the original throw in `SemanticError.detail`, and
 * both classes that can land there — `EmbeddingError` (`embeddingTypes.ts:48`,
 * a getter) and `QdrantError` (`qdrantTypes.ts:17`, a field) — already carry a
 * `retryable` verdict computed by the code that knows what went wrong. Reading
 * it structurally reuses that judgement instead of maintaining a second table of
 * error codes here, which would drift the moment either taxonomy grew a case.
 *
 * `=== true` rather than a truthiness test: an unrecognised cause must fall to
 * the conservative branch, not be promoted by a stray truthy value.
 */
function isTransientCause(detail: unknown): boolean {
  if (typeof detail !== 'object' || detail === null) return false;
  return (detail as { retryable?: unknown }).retryable === true;
}

/** Translate the service's structured error into the app's HTTP error helpers. */
function toHttpError(err: unknown): never {
  if (err instanceof SemanticError) {
    if (err.code === 'not_member') throw forbidden('not_member', err.message);
    if (err.code === 'invalid_request') throw badRequest('invalid_request', err.message);

    // A6. `embedding_failed` / `search_failed` used to fall through to the generic
    // handler as `500 {code:'internal_error'}`, which is the one answer that tells
    // a client nothing: a dead Qdrant, an unreachable embedder and a genuine server
    // bug arrived identically. The desktop's retrieval taxonomy
    // (`memory/semanticFailure.ts`) branches on exactly this `status` + `code` pair
    // to decide whether the semantic leg is worth retrying, so an honest answer
    // here is what makes its breaker and health probe honest downstream.
    //
    // The split is by the cause's own verdict, not by status guesswork: a
    // provider outage or a Qdrant timeout is a 503 the caller should wait out; a
    // `config_invalid` or an unparseable upstream body is a 500 that no amount of
    // retrying fixes and that an operator must clear. Defaulting an unrecognised
    // cause to 500 also keeps the pre-A6 status for every case this cannot judge.
    //
    // `err.message` only — never `err.detail`. Both messages here are fixed
    // literals from the service ('Failed to embed the query.' / 'Vector search
    // failed.'), so exposing them leaks nothing, whereas `detail` holds the raw
    // upstream error, which can carry a request URL, an API key or a whole HTML
    // error page. It travels as `logCause`, which the error handler writes to the
    // log and never to the response — the operator gets the diagnosis the client
    // must not see. Without it the log would hold only the literal above, which
    // would relocate this increment's silent failure rather than remove it.
    throw isTransientCause(err.detail)
      ? serviceUnavailable(err.code, err.message, {
          retryAfterSeconds: SEMANTIC_RETRY_AFTER_SECONDS,
          logCause: err.detail,
        })
      : new AppError(500, err.code, err.message, true, { logCause: err.detail });
  }
  throw err;
}

export function createSemanticRouter(deps: SemanticSearchDeps): Router {
  const router = Router();

  router.post(
    '/:orgId/search',
    h(async (req, res) => {
      const parsed = SearchBody.safeParse(req.body);
      if (!parsed.success) throw badRequest('invalid_request', 'Invalid search body.');
      try {
        const result = await semanticSearchQuery(deps, {
          orgId: req.params.orgId,
          userId: actorId(req),
          text: parsed.data.text,
          limit: parsed.data.limit,
        });
        res.json(result);
      } catch (err) {
        toHttpError(err);
      }
    }),
  );

  return router;
}
