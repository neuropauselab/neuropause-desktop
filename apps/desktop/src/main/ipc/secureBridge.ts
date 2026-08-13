/**
 * Secure IPC middleware for the runtime-core channels. Every runtime/registry/
 * NPS/catalog call passes through one pipeline that enforces, in order:
 *
 *   1. Sender trust   — only our own renderer frame may invoke.
 *   2. Auth gate      — channels marked requireAuth need an authenticated user.
 *   3. Permission     — channels declaring `permission` require the current
 *                       actor to hold that enterprise permission (RBAC).
 *   4. Validation     — the payload is parsed against its Zod schema.
 *   5. Timeout        — handlers are bounded so a hung backend can't wedge IPC.
 *   6. Audit          — each call is recorded (channel, outcome, duration).
 *   7. Error shaping  — failures surface as clean, user-safe messages.
 *
 * This is the boundary the renderer never crosses: it speaks only these typed
 * channels, never the backend directly.
 */
import { join } from 'node:path';
import { app, ipcMain } from 'electron';
import type { ZodSchema } from 'zod';
import type { EnterprisePermission, IpcChannelName, IpcResponseMap } from '@neuropause/shared';
import { createLogger } from '../logger';
import { createBoundedLog } from '../storage/boundedLog';
import { isTrustedSenderFrame } from './router';

const log = createLogger('secure-ipc');
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * One registration, bound to the channel it registers.
 *
 * A7 — `handler` used to return `unknown`, which meant the response side of every
 * channel was undescribed: the main process could return anything, the renderer
 * asserted a shape at the call site, and nothing compared the two. `IpcResponseMap`
 * (in @neuropause/shared) is now that description, and this type is what makes the
 * main process answer to it — for a channel with a contract, the handler must return
 * the shape the renderer will read, or it does not compile.
 *
 * Channels absent from the map — broadcast-only channels, and anything the renderer
 * never invokes — keep the loose return. Absence is honest here: there is no caller
 * whose expectations a return type could disagree with.
 */
export interface SecureHandlerDefFor<C extends IpcChannelName> {
  channel: C;
  schema: ZodSchema;
  handler: C extends keyof IpcResponseMap
    ? (payload: unknown) => IpcResponseMap[C] | Promise<IpcResponseMap[C]>
    : (payload: unknown) => unknown | Promise<unknown>;
  requireAuth?: boolean;
  /** RBAC: the enterprise permission the current actor must hold to invoke. */
  permission?: EnterprisePermission;
  audit?: boolean;
  timeoutMs?: number;
}

/**
 * The registration type every module's `handlers` array is annotated with. It is a
 * union discriminated by `channel`, so an element written as
 * `{ channel: IpcChannel.KbMatrix, ... }` is checked against that channel's contract
 * specifically — the ~24 existing `const handlers: SecureHandlerDef[] = [...]`
 * annotation sites gained response checking without a single edit.
 */
export type SecureHandlerDef = {
  [C in IpcChannelName]: SecureHandlerDefFor<C>;
}[IpcChannelName];

/**
 * The same registration with its channel binding erased.
 *
 * The bridge machinery below is channel-agnostic on purpose: it validates, times,
 * audits and shapes errors identically for every channel and never looks at what a
 * handler returns. Given the discriminated union it would have to call a union of
 * ~675 signatures to do that, so it takes this instead. Every `SecureHandlerDef` is
 * assignable to it — the erasure is one-way, and it happens after the contract has
 * already been enforced at the registration site.
 */
export interface AnySecureHandlerDef {
  channel: IpcChannelName;
  schema: ZodSchema;
  handler: (payload: unknown) => unknown | Promise<unknown>;
  requireAuth?: boolean;
  permission?: EnterprisePermission;
  audit?: boolean;
  timeoutMs?: number;
}

export interface SecureBridgeDeps {
  /** Whether a user session is currently authenticated. */
  isAuthenticated: () => boolean;
  /**
   * Assert the current actor holds a permission; throws when they do not.
   * A channel that declares `permission` fails closed if this dep is absent.
   */
  authorize?: (permission: EnterprisePermission) => void;
}

function auditPath(): string {
  return join(app.getPath('userData'), 'logs', 'audit.log');
}

/**
 * Fire-and-forget structured audit line; never blocks the IPC response.
 * Phase 8 (8.4): bounded — audit.log rotates at 5 MiB with 3 generations
 * kept, so a long-lived install no longer grows it without limit while the
 * recent privileged-action history (current + rotated, all inside logs/)
 * still lands in every support bundle.
 */
const auditLog = createBoundedLog(auditPath, { maxBytes: 5 * 1024 * 1024, keep: 3 });
function appendAudit(record: Record<string, unknown>): void {
  auditLog.append(JSON.stringify({ at: new Date().toISOString(), ...record }));
}

class IpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcError';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, channel: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new IpcError(`Request timed out: ${channel}`)), ms);
    timer.unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * The transport-neutral core of the secure pipeline: auth gate → permission (RBAC)
 * → Zod validation → bounded handler execution. It is deliberately free of the
 * IPC-only sender-trust check and of auditing, so it can be reused by any front
 * door that has already established sender trust (the IPC bridge below, and the
 * P3.0 REST API gateway). Throws `IpcError` with a clean message on any failure.
 */
export async function runSecureHandler(
  def: AnySecureHandlerDef,
  rawPayload: unknown,
  deps: SecureBridgeDeps,
): Promise<unknown> {
  if (def.requireAuth && !deps.isAuthenticated()) {
    throw new IpcError('Sign in to continue.');
  }
  if (def.permission) {
    if (!deps.authorize) {
      throw new IpcError('Authorization is not available.');
    }
    deps.authorize(def.permission);
  }
  const parsed = def.schema.safeParse(rawPayload ?? {});
  if (!parsed.success) {
    log.warn('Invalid payload', { channel: def.channel, issues: parsed.error.issues.length });
    throw new IpcError(`Invalid request for ${def.channel}`);
  }
  return withTimeout(
    Promise.resolve(def.handler(parsed.data)),
    def.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    def.channel,
  );
}

export function registerSecureHandlers(defs: AnySecureHandlerDef[], deps: SecureBridgeDeps): void {
  for (const def of defs) {
    // P13C O-3. `ipcMain.handle` THROWS on a channel that already has a handler,
    // which is why the real handler could not simply replace a bootstrap-time
    // placeholder. Removing first makes registration idempotent: the authority
    // surface is unchanged (the same def, the same gate, the same audit), and a
    // channel answered early by `earlyReachability.ts` is taken over here rather
    // than colliding with it.
    ipcMain.removeHandler(def.channel);
    ipcMain.handle(def.channel, async (event, rawPayload: unknown) => {
      const started = Date.now();
      try {
        if (!isTrustedSenderFrame(event)) {
          throw new IpcError('Untrusted sender');
        }
        const result = await runSecureHandler(def, rawPayload, deps);

        if (def.audit) {
          appendAudit({ channel: def.channel, ok: true, durationMs: Date.now() - started });
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unexpected error';
        if (def.audit) {
          appendAudit({
            channel: def.channel,
            ok: false,
            durationMs: Date.now() - started,
            error: message,
          });
        }
        log.warn('IPC handler error', { channel: def.channel, message });
        // Surface a clean message to the renderer (never internal stack detail).
        throw new IpcError(message);
      }
    });
  }
  log.info('Secure IPC handlers registered', { count: defs.length });
}
