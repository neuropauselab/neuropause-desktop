/**
 * THE PLATFORM OPERATOR — THE ONE AUTHORITY THAT IS NOT PER-ORGANIZATION.
 *
 * WHY THIS EXISTS
 *
 * Every authority in NeuroPause is granted by an organization role, resolved
 * through the caller's membership in the ACTIVE organization. That is correct for
 * everything an organization owns, and it cannot express the authority the
 * control plane needs, because rate-limit policies, deployment replicas and the
 * shared runtime belong to the MACHINE. `cloud:manage` was standing in for it and
 * is held by every organization's Admin — so tenant A's administrator could
 * disable the rate limit protecting tenant B, and creating a second organization
 * (which anyone may do) made you its Owner and handed you the same reach.
 *
 * HOW AUTHORITY IS ESTABLISHED, AND WHY THERE IS NO IPC TO GRANT IT
 *
 * Operators are listed OUT OF BAND: a `platform-operators.json` file in the app's
 * data directory, or `NEUROPAUSE_PLATFORM_OPERATORS` for development. There is
 * deliberately NO channel, no settings screen and no bootstrap-if-empty path that
 * lets a signed-in user make themselves one.
 *
 * That is the entire security property. An in-app grant path would be reachable
 * by whoever is signed in, which is exactly the person this role exists to be
 * above — "the first user to ask becomes the operator" is not an authority model,
 * it is a race. Writing the file requires filesystem access to the machine, which
 * is a claim the operating system already adjudicates and this program should not
 * try to re-adjudicate worse.
 *
 * EMPTY MEANS NOBODY. An install with no operator file has no platform operator,
 * and every platform-only operation is refused for everyone. That is the correct
 * default for a product whose current shape is one organization per machine: the
 * capability is unreachable until someone deliberately reaches for it.
 *
 * WHAT IT DELIBERATELY IS NOT
 *
 *   - not a role (roles are per organization, and are editable through org IPC)
 *   - not a permission an org role can hold (`PLATFORM_ONLY_PERMISSIONS`)
 *   - not derived from Owner, from `ORG_ID`, from the home tenant, or from being
 *     first — every one of those is a per-organization fact wearing an
 *     install-level costume, and this program has removed four of them already
 *   - not conferred by switching organizations, because it is not keyed on one
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger';

const log = createLogger('platform-operator');

/** Shape of `platform-operators.json`. Deliberately tiny. */
interface OperatorFile {
  /** Email addresses, matched case-insensitively after trimming. */
  operators?: unknown;
}

/** Normalize an identity for comparison. Email matching is case-insensitive. */
function normalize(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const t = email.trim().toLowerCase();
  return t === '' ? null : t;
}

export class PlatformOperatorRegistry {
  private operators = new Set<string>();
  private loaded = false;

  /**
   * @param dataDir The app data directory. Injected rather than read from
   *                `app.getPath` so this file stays Electron-free and testable —
   *                a boundary that can only be exercised through the full app is
   *                a boundary that does not get exercised.
   * @param env     Process env, injected for the same reason.
   */
  constructor(
    private readonly dataDir: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /**
   * Read the operator list. Safe to call repeatedly.
   *
   * A MISSING FILE IS NOT AN ERROR AND NOT A BOOTSTRAP. It means no operator, and
   * the registry stays empty. A MALFORMED file is also empty — a corrupt list must
   * never be interpreted generously, because the generous interpretation of
   * "who may reconfigure the shared runtime" is the wrong one every time.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const fromEnv = (this.env.NEUROPAUSE_PLATFORM_OPERATORS ?? '')
      .split(',')
      .map(normalize)
      .filter((e): e is string => e !== null);
    for (const e of fromEnv) this.operators.add(e);

    try {
      const raw = await fs.readFile(join(this.dataDir, 'platform-operators.json'), 'utf8');
      const parsed = JSON.parse(raw) as OperatorFile;
      if (Array.isArray(parsed.operators)) {
        for (const entry of parsed.operators) {
          const e = normalize(typeof entry === 'string' ? entry : null);
          if (e !== null) this.operators.add(e);
        }
      }
    } catch {
      // Missing or unreadable. Stay empty. See the note above.
    }

    // COUNT ONLY. An operator's address is an administrative identity and this
    // log line is read by whoever can read the log.
    log.info('Platform operator registry ready', { operators: this.operators.size });
  }

  /**
   * Whether this identity is a platform operator.
   *
   * Takes the SESSION email, and nothing else. No organization, no role, no
   * workspace — deliberately, so that no caller can pass a tenant-derived value
   * and have it influence the answer.
   */
  isOperator(email: string | null | undefined): boolean {
    const e = normalize(email);
    return e !== null && this.operators.has(e);
  }

  /** How many operators are configured. For diagnostics; never the addresses. */
  count(): number {
    return this.operators.size;
  }
}
