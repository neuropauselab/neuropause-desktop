/**
 * AI Sandbox — Enterprise Scenario Runner (S3): the REAL desktop channel.
 *
 * Reuses the S2 machinery wholesale — the `PlaywrightDesktopDriver`, the `SessionManager`
 * (isolated profiles), and the `runAction` interpreter — to let an enterprise scenario's
 * desktop steps drive the real NeuroPause Electron app. No new automation engine; this is
 * a thin adapter that exposes S2 through the {@link EnterpriseDesktopChannel} port. Like
 * the rest of the real platform it is integration-tested on a machine with a display; the
 * gates exercise the fake channel through the same port.
 *
 * P13C ROUND 9 — F15/F16. SESSIONS ARE OWNER-KEYED, AND SO ARE THEIR SCREENSHOTS.
 *
 * This adapter used to hold `const state: { managed, window, shots }` — ONE slot,
 * on a channel constructed once at the composition root. Every tenant's scenario
 * steps reached the same three fields, so tenant B's `screenshot` returned PNG
 * bytes of tenant A's live window, B's `click` drove A's window, and B's `close`
 * shut it. The slot is now a {@link DesktopSessionRegistry}: sessions are held
 * per owner, every operation resolves the owner BEFORE it executes, and a
 * foreign session is refused with an explicit `EnterprisePlatformError` rather
 * than silently ignored or silently replaced.
 *
 * F16 — screenshot PNGs were written straight into a shared `artifactsBaseDir`
 * as `<name>-<ts>-<n>.png`, so one tenant could read another's capture off disk
 * by guessing a scenario's step name. The path now carries the OWNER as
 * sanitized segments, derived from the resolver and never from a payload.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Artifact, DesktopAction } from '@neuropause/shared';
import { createLogger } from '../../logger';
import type { DesktopSessionHandle, DesktopSessionRef, EnterpriseDesktopChannel } from './platform';
import { PlaywrightDesktopDriver } from '../desktop/playwrightDriver';
import { SessionManager, type LaunchTarget, type ManagedSession } from '../desktop/sessionManager';
import { PerfCollector, runAction, type ActionRunContext } from '../desktop/actions';
import type { DesktopDriver, DesktopWindow } from '../desktop/driver';
import type { CaptureDeps } from '../desktop/capture';
import {
  DesktopSessionRegistry,
  type DesktopSessionOwner,
  type OwnedDesktopSession,
} from './desktopSessionOwnership';

const log = createLogger('sandbox-enterprise-desktop');

export interface RealDesktopChannelDeps {
  /**
   * P13C Round 7 — the tenant a persistent browser profile belongs to.
   * P13C Round 9 — and, now, the tenant that OWNS the running session.
   *
   * One resolver for both, deliberately: a profile directory and the window
   * opened on it must never be able to disagree about whose they are.
   */
  tenantId: () => string | null;
  /**
   * The workspace inside the tenant, when the composition root resolves one.
   *
   * OPTIONAL, and it is NOT the boundary — the tenant is; `desktopOwnerKey` in
   * `desktopSessionOwnership.ts` says why. It names the capture directory, so a
   * tenant's own screenshots stay grouped the way its scenarios and executions
   * are, and it appears on the session for diagnostics.
   */
  workspaceId?: () => string | null;
  /** The background principal that opened the session, for the audit line. */
  principalId?: () => string | null;
  launchTarget: LaunchTarget;
  profilesDir: string;
  artifactsBaseDir: string;
  /**
   * The automation backend. Defaults to the real Playwright driver.
   *
   * Injected so the isolation suite can run headless through the same code path
   * production uses — a test that had to reach a display would not run in the
   * gates, and an untested ownership check is the one that regresses.
   */
  driver?: DesktopDriver;
  now?: () => number;
}

/** A no-op capture sink — enterprise desktop screenshots are written directly (below),
 *  and `runAction` never takes the 'screenshot' branch for the actions we send it. */
const NOOP_CAPTURE_ATTACH: CaptureDeps['attach'] = () => ({}) as Artifact;

interface RealDesktopSession extends OwnedDesktopSession {
  managed: ManagedSession;
  window: DesktopWindow;
  shots: number;
}

export function createRealDesktopChannel(deps: RealDesktopChannelDeps): EnterpriseDesktopChannel {
  const now = deps.now ?? Date.now;
  const driver = deps.driver ?? new PlaywrightDesktopDriver();
  const sessions = new SessionManager({
    driver,
    profilesDir: deps.profilesDir,
    // P13C Round 7 — see SessionManagerDeps.tenantId. Required, not optional: an
    // optional tenant on a filesystem path defaults to a shared directory, which
    // is what the finding was.
    tenantId: deps.tenantId,
    launchTarget: deps.launchTarget,
    now,
  });
  const perf = new PerfCollector();
  /**
   * The slot F15 found, with an owner on it.
   *
   * The resolver is the SAME one the session manager uses for profile paths, so
   * the directory a session writes to and the tenant allowed to reach that
   * session cannot drift apart.
   */
  const registry = new DesktopSessionRegistry<RealDesktopSession>(() => ({
    tenantId: deps.tenantId(),
    workspaceId: deps.workspaceId?.() ?? null,
    principalId: deps.principalId?.() ?? null,
  }));

  /**
   * Where THIS owner's captures live. F16.
   *
   * Every segment is sanitized, so a tenant id or workspace id containing
   * `../` cannot climb out of the base directory into another tenant's
   * captures — the same rule `SessionManager.resolveProfileDir` applies, for
   * the same reason.
   */
  const artifactsDirFor = (owner: DesktopSessionOwner): string =>
    join(deps.artifactsBaseDir, 'tenants', safeSegment(owner.tenantId), safeSegment(owner.workspaceId ?? '_tenant'));

  const actionCtx = (session: RealDesktopSession): ActionRunContext => ({
    session: session.managed.session,
    window: session.window,
    capture: { artifactsDir: artifactsDirFor(session.owner), attach: NOOP_CAPTURE_ATTACH, now },
    emitStep: () => undefined,
    emitLog: () => undefined,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    defaultTimeoutMs: 30_000,
    perf,
    now,
  });

  return {
    open: async (opts): Promise<DesktopSessionHandle> => {
      // Ownership first: an unresolved tenant gets no session at all, and a
      // name that is not this owner's cannot select another owner's session.
      const claim = registry.claim(opts?.sessionId, 'open');
      if (claim.existing) {
        // Re-opening a name I already hold is idempotent while it is alive; if it
        // died, the corpse is reaped before the replacement takes its name, so a
        // crashed session cannot accumulate in the launcher under a live id.
        if (claim.existing.managed.session.isRunning()) return { sessionId: claim.existing.sessionId };
        await destroy(claim.existing);
      }
      const managed = await sessions.launch({ profile: 'temporary', profileKey: opts?.profile ?? null, args: [], timeoutMs: 30_000, captureConsole: true });
      const window = await managed.session.firstWindow({ timeoutMs: 30_000 });
      const session: RealDesktopSession = { sessionId: claim.sessionId, owner: claim.owner, managed, window, shots: 0 };
      registry.put(session);
      log.info('enterprise desktop session opened', {
        id: managed.id,
        sessionId: session.sessionId,
        tenantId: claim.owner.tenantId,
        principalId: claim.owner.principalId,
        openSessions: registry.size(),
      });
      return { sessionId: session.sessionId };
    },

    // `async` so a refusal REJECTS rather than throwing synchronously: the port
    // promises a Promise, and a caller that only handles rejection would
    // otherwise see an ownership denial escape its error handling.
    action: async (action: DesktopAction, ref?: DesktopSessionRef) => runAction(action, actionCtx(registry.require(ref, `desktop ${action.type}`))),

    screenshot: async (name, ref?: DesktopSessionRef) => {
      const session = registry.require(ref, 'screenshot');
      const bytes = await session.window.screenshot();
      session.shots += 1;
      const dir = artifactsDirFor(session.owner);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => undefined);
      const file = join(dir, `${safe(name)}-${now()}-${session.shots}.png`);
      await fs.writeFile(file, bytes, { mode: 0o600 });
      return { storageRef: file, sizeBytes: bytes.length };
    },

    isOpen: (ref?: DesktopSessionRef) => {
      const session = registry.peek(ref);
      return !!session && session.managed.session.isRunning();
    },

    close: async (ref?: DesktopSessionRef) => {
      /**
       * A NAMED close is refused when it is not this owner's; an UNNAMED close
       * is "close mine, if any" and stays idempotent, because the executor calls
       * it at the end of every run whether or not a session was opened.
       */
      if (ref?.sessionId) {
        const session = registry.require(ref, 'close');
        await destroy(session);
        return;
      }
      const mine = registry.peek();
      if (mine) await destroy(mine);
    },
  };

  async function destroy(session: RealDesktopSession): Promise<void> {
    registry.drop(session);
    await sessions.close(session.managed.id).catch(() => undefined);
  }
}

function safe(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'screenshot';
}

/**
 * One path segment, with no way out of it.
 *
 * Same rule as `SessionManager`'s: a leading `.` is replaced so `..` can never
 * survive, because a tenant segment that can climb is not a boundary.
 */
function safeSegment(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  return cleaned === '' ? '_' : cleaned.slice(0, 120);
}
