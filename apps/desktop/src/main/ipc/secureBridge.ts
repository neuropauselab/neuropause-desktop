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
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain } from 'electron';
import type { ZodSchema } from 'zod';
import type { EnterprisePermission, IpcChannelName } from '@neuropause/shared';
import { createLogger } from '../logger';
import { isTrustedSenderFrame } from './router';

const log = createLogger('secure-ipc');
const DEFAULT_TIMEOUT_MS = 30_000;

export interface SecureHandlerDef {
  channel: IpcChannelName;
  schema: ZodSchema;
  handler: (payload: unknown) => unknown | Promise<unknown>;
  requireAuth?: boolean;
  /** RBAC: the enterprise permission the current actor must hold to invoke. */
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

/** Fire-and-forget structured audit line; never blocks the IPC response. */
function appendAudit(record: Record<string, unknown>): void {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`;
  void fs
    .mkdir(join(app.getPath('userData'), 'logs'), { recursive: true })
    .then(() => fs.appendFile(auditPath(), line))
    .catch(() => undefined);
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
  def: SecureHandlerDef,
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

export function registerSecureHandlers(defs: SecureHandlerDef[], deps: SecureBridgeDeps): void {
  for (const def of defs) {
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
