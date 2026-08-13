/**
 * PrivateFirstClient — the composite ModelClient that IS the Private First
 * promise, in code.
 *
 * It holds the ordered route attempts produced by `planRoute` and, at
 * `complete()` time, tries them in order: local first, then private
 * infrastructure, then — only when the plan includes it, which requires
 * explicit consent — an external provider. The first route that answers wins,
 * and the result is stamped with `AiRoutingMetadata` describing what ACTUALLY
 * happened: which location served it, which model, and every route that was
 * tried and failed first.
 *
 * Two properties matter more than everything else here:
 *
 * 1. **A refused plan never degrades into a network call.** When the planner
 *    said no route is permitted, this client is constructed empty and
 *    `complete()` throws the planner's refusal. There is no code path from
 *    "external disabled" to an external request.
 * 2. **The metadata is written by the execution, not the configuration.** The
 *    stamp happens after `client.complete()` returns, naming the candidate
 *    that answered — a config that says "local" while a remote URL serves the
 *    request would be reported as what it is, because classification happened
 *    against the endpoint, not the label.
 *
 * Pure composition: no Electron, unit-tests with fake clients.
 */
import type { AiMode, AiRouteCandidate, AiRouteSkip, AiRoutingMetadata } from '@neuropause/shared';
import { PROCESSING_LOCATION_LABELS } from '@neuropause/shared';
import type { ModelClient, ModelRequest, ModelResult } from './modelClient';

/** A candidate route bound to the client that would serve it. */
export interface BoundRoute {
  candidate: AiRouteCandidate;
  client: ModelClient;
}

export interface PrivateFirstClientOptions {
  /** Attempt order, produced by `planRoute`. May be empty (refused plan). */
  routes: readonly BoundRoute[];
  mode: AiMode;
  /** The planner's refusal, thrown verbatim when `routes` is empty. */
  refusal?: string | null;
  now?: () => string;
}

/** A ModelResult carrying the routing stamp of the execution that produced it. */
export interface RoutedModelResult extends ModelResult {
  routing: AiRoutingMetadata;
}

export class PrivateFirstClient implements ModelClient {
  readonly provider = 'private-first';
  private readonly routes: readonly BoundRoute[];
  private readonly mode: AiMode;
  private readonly refusal: string | null;
  private readonly now: () => string;

  constructor(opts: PrivateFirstClientOptions) {
    this.routes = opts.routes;
    this.mode = opts.mode;
    this.refusal = opts.refusal ?? null;
    this.now = opts.now ?? ((): string => new Date().toISOString());
  }

  /**
   * Configured = at least one permitted route exists. When false, the AiEngine
   * takes its deterministic-fallback path without any network activity — which
   * is exactly what a refused plan requires.
   */
  isConfigured(): boolean {
    return this.routes.some((r) => r.client.isConfigured());
  }

  async complete(req: ModelRequest): Promise<RoutedModelResult> {
    if (this.routes.length === 0) {
      throw new Error(this.refusal ?? 'No AI route is available.');
    }

    const attempted: AiRouteSkip[] = [];
    for (const route of this.routes) {
      const { candidate, client } = route;
      if (!client.isConfigured()) {
        attempted.push({
          provider: candidate.provider,
          location: candidate.location,
          reason: 'Not configured at execution time.',
        });
        continue;
      }
      try {
        // Each route serves its OWN model — a request planned for a local
        // llama tag must not be replayed verbatim against an external API.
        const result = await client.complete({ ...req, model: candidate.model });
        return {
          ...result,
          routing: {
            location: candidate.location,
            provider: candidate.provider,
            model: result.model,
            mode: this.mode,
            reason: this.reasonFor(candidate, attempted),
            attempted,
            decidedAt: this.now(),
          },
        };
      } catch (err) {
        attempted.push({
          provider: candidate.provider,
          location: candidate.location,
          reason: err instanceof Error ? err.message : 'The route failed.',
        });
      }
    }

    // Every permitted route failed. The error names each attempt so the user
    // reads what was tried — and, implicitly, what was NOT: no route outside
    // the plan was contacted.
    const detail = attempted
      .map((a) => `${PROCESSING_LOCATION_LABELS[a.location]} (${a.provider}): ${a.reason}`)
      .join('; ');
    throw new Error(`No permitted AI route could serve this request. Tried: ${detail}`);
  }

  private reasonFor(candidate: AiRouteCandidate, attempted: readonly AiRouteSkip[]): string {
    if (candidate.location === 'local') {
      return attempted.length === 0
        ? 'This task ran locally because a local model was available — nothing needed to leave this device.'
        : 'This task ran locally after earlier routes failed.';
    }
    if (candidate.location === 'private_infrastructure') {
      return attempted.length === 0
        ? 'This task ran on your configured private AI infrastructure.'
        : 'No local model was available, so this ran on your configured private AI infrastructure.';
    }
    return attempted.length === 0
      ? 'This task ran on the external provider you enabled.'
      : 'No local or private route was available, so this ran on the external provider you enabled.';
  }
}
