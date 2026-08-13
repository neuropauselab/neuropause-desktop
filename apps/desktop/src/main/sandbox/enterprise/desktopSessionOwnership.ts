/**
 * AI Sandbox — Enterprise Scenario Runner (S3): WHO A DESKTOP SESSION BELONGS TO.
 *
 * P13C ROUND 9 — F15. ONE SLOT, EVERY TENANT.
 *
 * `createRealDesktopChannel` held a single `{ managed, window, shots }` and the
 * channel is built ONCE at the composition root, so every tenant's scenario
 * steps reached the same three fields. While tenant A's session was open, a
 * scenario run by tenant B could call `screenshot` and receive PNG bytes of A's
 * window, drive clicks into it, or close it. Cross-tenant READ and CONTROL, from
 * a variable that never looked like a store and therefore never appeared in a
 * store sweep.
 *
 * Round 7 fixed the adjacent half: `SessionManager` takes a `tenantId` so a
 * persistent Chromium profile directory is per tenant. That made the DISK
 * per-tenant and left the RUNNING WINDOW shared, which is the sharper of the
 * two — a profile directory discloses what a previous run stored, a live window
 * discloses what the other tenant is looking at right now.
 *
 * THE MODEL
 *
 *     sessionId → { ownerTenant, ownerWorkspace, openedByPrincipal }
 *
 * The owner is AUTHORITATIVE and comes from the injected resolver. A caller — a
 * renderer payload, a scenario step — may name a `sessionId`; it may never name
 * an owner, and a named id only ever selects among the CALLER'S OWN sessions.
 * That is why session ids are stored in a per-owner namespace: two tenants may
 * both open a session called `main` and each gets their own, so a caller-chosen
 * name is neither a way in nor a way to squat on somebody else's name.
 *
 * WHY THE REGISTRY IS SHARED BETWEEN THE REAL AND THE FAKE CHANNEL
 *
 * The gates run headless and exercise the FAKE channel through the same port. A
 * fake with the old single-slot shape would keep every gate green while
 * production leaked — the precise failure mode the finding warns about. Both
 * implementations therefore resolve ownership through THIS class, so a test that
 * proves the fake refuses a foreign session is proving the production rule.
 *
 * FAIL CLOSED. No resolved tenant means no session and no bytes; there is
 * deliberately no variant of `requireOwner` that substitutes a default
 * organization, the first organization, or the currently active one.
 */
import { EnterprisePlatformError, type DesktopSessionRef } from './platform';

/** The authoritative owner of one desktop session. Never caller-supplied. */
export interface DesktopSessionOwner {
  tenantId: string;
  /**
   * The workspace the session was opened from, when one resolves.
   *
   * RECORDED — it names the capture directory and appears in the log line — but
   * deliberately NOT part of the key. See {@link desktopOwnerKey}.
   */
  workspaceId: string | null;
  /**
   * The background principal that opened the session, or null on the UI path.
   *
   * RECORDED, NOT KEYED. The tenant a job acts for already comes from the
   * resolver (`activeTenantScope` prefers a background principal over the
   * session), so keying on the principal as well would split a tenant's own
   * sessions between its UI and its jobs without adding a boundary. It is kept
   * because "which job opened this window" is the first question asked of a
   * session that is still open when nobody expects one.
   */
  principalId: string | null;
}

/** What a resolver may report. `tenantId: null` ⇒ unresolved ⇒ nobody's. */
export interface DesktopOwnerResolution {
  tenantId: string | null;
  workspaceId?: string | null;
  principalId?: string | null;
}

/** How the channel learns who is calling. Injected, never imported. */
export type DesktopOwnerResolver = () => DesktopOwnerResolution | null;

/** A named session that exists but is not the caller's — or does not exist. */
export const DESKTOP_DENIED = 'desktop_denied';
/** No tenant resolved, so there is nobody to own or reach a session. */
export const DESKTOP_NO_OWNER = 'desktop_no_owner';
/** The caller has no session open. The pre-existing code, kept for its callers. */
export const DESKTOP_CLOSED = 'desktop_closed';

/** Anything the registry can hold. Implementations add their own fields. */
export interface OwnedDesktopSession {
  readonly sessionId: string;
  readonly owner: DesktopSessionOwner;
}

function nonEmpty(v: string | null | undefined): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** Two owners are the same when their TENANT matches. See {@link desktopOwnerKey}. */
export function sameOwner(a: DesktopSessionOwner, b: DesktopSessionOwner): boolean {
  return a.tenantId === b.tenantId;
}

/**
 * THE OWNER IS THE TENANT. Not the workspace, and not the scenario run.
 *
 * The three candidates, and why this one:
 *
 * PER SCENARIO RUN would be the narrowest, and the port cannot express it: an
 * `EnterpriseDesktopChannel` has no run id, and the executor auto-opens a
 * session lazily from inside a step (`if (!isOpen()) open()`). A caller that
 * wants a session of its own can already have one by NAMING it — session ids
 * live in a per-owner namespace — so run-level separation is available without
 * inventing a boundary the port has no way to enforce.
 *
 * PER WORKSPACE is narrower than the tenant and is the wrong axis here.
 * `SandboxExecutionEngine.runOwned` — the code that runs every enterprise
 * scenario, and therefore every desktop step that reaches this channel — builds
 * its principal as `{ tenantId: row.tenantId, workspaceId: '' }`: TENANT-level,
 * deliberately, so a queued run executes for the organization that enqueued it
 * rather than from whichever workspace happens to be on screen. Keying on the
 * workspace would therefore split ONE tenant's own sessions between its runner
 * (no workspace) and its UI (a workspace) while adding no boundary between
 * tenants — a functional trap bought for nothing. The sandbox stores agree:
 * `sandboxTenancy.test.ts` asserts their isolation per TENANT, with
 * `workspaceId` a grouping inside a tenant rather than an authority.
 *
 * PER TENANT is also the granularity of the resource underneath. Round 7 made
 * the Chromium profile directory per tenant; keying the running window more
 * narrowly than the profile it runs on would put a boundary at one layer that
 * the layer beneath does not have, which is the half-fix that left F15 open.
 *
 * The workspace is still recorded on the session and still names the capture
 * directory, so a tenant's own captures stay organized — it is simply not what
 * decides access.
 */
export function desktopOwnerKey(owner: DesktopSessionOwner): string {
  return owner.tenantId;
}

/**
 * ONE refusal for "not yours" and for "no such session".
 *
 * Deliberately indistinguishable. Two different errors would answer the question
 * "does tenant B have a session called X?", which is a small disclosure that
 * costs nothing to withhold. It is still an EXPLICIT denial — it throws, so a
 * step fails and is reported — never a silent no-op and never an implicit
 * "open a new one".
 */
export function desktopDenied(sessionId: string, op: string): EnterprisePlatformError {
  return new EnterprisePlatformError(
    `desktop session "${sessionId}" does not belong to this organization, so ${op} is refused`,
    DESKTOP_DENIED,
  );
}

export function desktopNoOwner(op: string): EnterprisePlatformError {
  return new EnterprisePlatformError(
    `no organization is active, so ${op} has no desktop session it may act on`,
    DESKTOP_NO_OWNER,
  );
}

export function desktopNotOpen(op: string): EnterprisePlatformError {
  return new EnterprisePlatformError(`desktop session not open (${op})`, DESKTOP_CLOSED);
}

/**
 * Every open desktop session on the install, keyed by its OWNER and its id.
 *
 * Holds sessions rather than rows, so it is not a store and persists nothing —
 * a process restart leaves no sessions to own.
 */
export class DesktopSessionRegistry<S extends OwnedDesktopSession> {
  private readonly byKey = new Map<string, S>();
  /** The session an owner's ref-less calls act on. Per owner, never global. */
  private readonly currentByOwner = new Map<string, string>();
  private seq = 0;

  constructor(private readonly resolveOwner: DesktopOwnerResolver) {
    /**
     * A bad resolver must be loud HERE, at composition.
     *
     * `TenantOwnership.bindScope` states the reason and this is the same trap: a
     * resolver that is `undefined` rather than a function would make every
     * lookup throw at call time instead — "passes every check and breaks later
     * somewhere else", the worst of the three outcomes.
     */
    if (typeof resolveOwner !== 'function') {
      throw new TypeError(
        `DesktopSessionRegistry(${String(resolveOwner)}): the owner boundary must be a resolver function.`,
      );
    }
  }

  /** The owner of THIS call, or null when no tenant resolves. */
  owner(): DesktopSessionOwner | null {
    const raw = this.resolveOwner();
    const tenantId = nonEmpty(raw?.tenantId);
    if (raw === null || tenantId === null) return null;
    return { tenantId, workspaceId: nonEmpty(raw.workspaceId), principalId: nonEmpty(raw.principalId) };
  }

  /** The owner, or a refusal. The only way a write-side operation gets an owner. */
  requireOwner(op: string): DesktopSessionOwner {
    const owner = this.owner();
    if (owner === null) throw desktopNoOwner(op);
    return owner;
  }

  /** `\u0000` cannot appear in a tenant id or a session name, so a caller-chosen
   *  name cannot be crafted to collide with another owner's namespace. */
  private static keyOf(owner: DesktopSessionOwner, sessionId: string): string {
    return `${desktopOwnerKey(owner)}\u0000${sessionId}`;
  }

  /**
   * Reserve an id for a NEW session, or hand back the caller's live one.
   *
   * A caller-supplied name that is already live FOR THIS OWNER is returned as
   * `existing` so `open` is idempotent (the executor auto-opens with
   * `if (!isOpen()) open()`). A name that is live for anybody else is invisible:
   * the caller gets a fresh session of their own under their own namespace, and
   * cannot tell whether the name was taken.
   */
  claim(requested: string | null | undefined, op: string): { owner: DesktopSessionOwner; sessionId: string; existing: S | null } {
    const owner = this.requireOwner(op);
    const name = nonEmpty(requested);
    if (name === null) {
      this.seq += 1;
      return { owner, sessionId: `desk_${this.seq}`, existing: null };
    }
    const sessionId = name.slice(0, 120);
    return { owner, sessionId, existing: this.byKey.get(DesktopSessionRegistry.keyOf(owner, sessionId)) ?? null };
  }

  /**
   * The session this call may touch, or an explicit refusal.
   *
   * EVERY operation goes through here before it executes — open, action,
   * screenshot, capture, state, close. There is no second lookup path.
   */
  require(ref: DesktopSessionRef | undefined, op: string): S {
    const owner = this.requireOwner(op);
    const named = nonEmpty(ref?.sessionId);
    if (named !== null) {
      const found = this.byKey.get(DesktopSessionRegistry.keyOf(owner, named));
      // The key already carries the owner; re-checking the record costs nothing
      // and catches a key-construction bug rather than trusting it.
      if (!found || !sameOwner(found.owner, owner)) throw desktopDenied(named, op);
      return found;
    }
    const current = this.currentByOwner.get(desktopOwnerKey(owner));
    const found = current === undefined ? undefined : this.byKey.get(DesktopSessionRegistry.keyOf(owner, current));
    if (!found) throw desktopNotOpen(op);
    return found;
  }

  /**
   * The same lookup as a predicate. Never throws.
   *
   * `isOpen()` is a boolean on the port and the executor calls it outside a
   * `try`, so its refusal has to be an answer rather than an exception — and
   * "no" is the honest answer to "is my session open?" when the caller has none,
   * when the named one is somebody else's, and when no tenant resolved at all.
   */
  peek(ref?: DesktopSessionRef): S | null {
    const owner = this.owner();
    if (owner === null) return null;
    const named = nonEmpty(ref?.sessionId);
    const id = named ?? this.currentByOwner.get(desktopOwnerKey(owner));
    if (id === undefined) return null;
    const found = this.byKey.get(DesktopSessionRegistry.keyOf(owner, id));
    return found && sameOwner(found.owner, owner) ? found : null;
  }

  /** Record a session and make it the owner's current one. */
  put(session: S): void {
    this.byKey.set(DesktopSessionRegistry.keyOf(session.owner, session.sessionId), session);
    this.currentByOwner.set(desktopOwnerKey(session.owner), session.sessionId);
  }

  /** Forget a session. Only ever called with a session `require`/`peek` returned. */
  drop(session: S): void {
    const ownerKey = desktopOwnerKey(session.owner);
    this.byKey.delete(DesktopSessionRegistry.keyOf(session.owner, session.sessionId));
    if (this.currentByOwner.get(ownerKey) === session.sessionId) this.currentByOwner.delete(ownerKey);
  }

  /** How many sessions are open install-wide. A count, no ids, for diagnostics. */
  size(): number {
    return this.byKey.size;
  }
}
