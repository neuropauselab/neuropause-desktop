/**
 * Plugin host process manager. Code plugins (background/automation/ai_agent/
 * mcp_server) run in their own forked Node process via the plugin-host shim, so
 * a plugin cannot touch the Electron main process or the renderer directly.
 * Every privileged host call the plugin makes is enforced here against the
 * plugin's granted permissions before it is honored.
 *
 * Process isolation, lifecycle, log capture, and crash detection are real. The
 * `runModel` capability is a declared seam (gated by local_models) until a local
 * model runtime is wired.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { app, Notification } from 'electron';
import type { HealthStatus, PluginHostEvent, PluginManifest, RuntimePermissionKey, RuntimeStatus } from '@neuropause/shared';
import { createLogger } from '../logger';

const log = createLogger('plugin-host');

interface HostProc {
  pluginId: string;
  child: ChildProcess;
  status: RuntimeStatus;
  permissions: Set<RuntimePermissionKey>;
  intentionalStop: boolean;
}

/** Resolves the shim path across dev and packaged layouts. */
function resolveShimPath(): string | null {
  const candidates = [
    join(app.getAppPath(), 'resources', 'plugin-host.cjs'),
    join(__dirname, '..', 'resources', 'plugin-host.cjs'),
    join(process.resourcesPath ?? '', 'plugin-host.cjs'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function pluginDataPath(id: string): string {
  return join(app.getPath('userData'), 'plugin-data', `${id}.json`);
}

async function readKv(id: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(pluginDataPath(id), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeKv(id: string, kv: Record<string, unknown>): Promise<void> {
  const path = pluginDataPath(id);
  await fs.mkdir(join(app.getPath('userData'), 'plugin-data'), { recursive: true });
  await fs.writeFile(path, JSON.stringify(kv), { mode: 0o600 });
}

export class PluginHost extends EventEmitter {
  private procs = new Map<string, HostProc>();

  isRunning(pluginId: string): boolean {
    return this.procs.get(pluginId)?.status === 'running';
  }

  statusOf(pluginId: string): RuntimeStatus {
    return this.procs.get(pluginId)?.status ?? 'stopped';
  }

  private emitEvent(pluginId: string, type: PluginHostEvent['type'], opts: { status?: RuntimeStatus; health?: HealthStatus; message?: string }): void {
    const event: PluginHostEvent = {
      pluginId,
      type,
      status: opts.status ?? null,
      health: opts.health ?? null,
      message: opts.message ?? null,
      at: new Date().toISOString(),
    };
    this.emit('event', event);
  }

  /** Starts a plugin in its own process and waits until it reports ready. */
  async start(
    manifest: PluginManifest,
    pluginRoot: string,
    grantedPermissions: RuntimePermissionKey[],
  ): Promise<void> {
    if (!manifest.main) throw new Error('Plugin has no entry module');
    const shim = resolveShimPath();
    if (!shim) throw new Error('Plugin host shim not found (resources/plugin-host.cjs)');

    const entry = join(pluginRoot, manifest.main);
    if (!existsSync(entry)) throw new Error(`Plugin entry not found: ${manifest.main}`);

    const child = fork(shim, [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NP_PLUGIN_ENTRY: entry },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    const proc: HostProc = {
      pluginId: manifest.id,
      child,
      status: 'starting',
      permissions: new Set(grantedPermissions),
      intentionalStop: false,
    };
    this.procs.set(manifest.id, proc);

    child.stdout?.on('data', (d: Buffer) => this.emitEvent(manifest.id, 'log', { message: d.toString().trim() }));
    child.stderr?.on('data', (d: Buffer) => this.emitEvent(manifest.id, 'log', { message: d.toString().trim() }));

    child.on('message', (msg: unknown) => void this.onMessage(proc, msg));

    child.on('exit', (code, signal) => {
      if (proc.intentionalStop) {
        proc.status = 'stopped';
        this.emitEvent(manifest.id, 'lifecycle', { status: 'stopped', health: 'unknown', message: 'Stopped' });
      } else {
        proc.status = 'crashed';
        this.emitEvent(manifest.id, 'crash', {
          status: 'crashed',
          health: 'unhealthy',
          message: `Plugin process exited (${signal ?? code})`,
        });
      }
      this.procs.delete(manifest.id);
    });

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Plugin did not become ready in time')), 10_000);
      timer.unref?.();
      const onReady = (msg: unknown): void => {
        const m = msg as { type?: string; message?: string };
        if (m.type === 'ready') {
          clearTimeout(timer);
          child.off('message', onReady);
          resolve();
        } else if (m.type === 'error') {
          clearTimeout(timer);
          child.off('message', onReady);
          reject(new Error(m.message ?? 'Plugin failed to activate'));
        }
      };
      child.on('message', onReady);
    });

    child.send({ type: 'init', pluginId: manifest.id, permissions: grantedPermissions });
    await ready;
    proc.status = 'running';
    this.emitEvent(manifest.id, 'lifecycle', { status: 'running', health: 'healthy', message: 'Activated' });
    log.info('Plugin activated', { id: manifest.id, pid: child.pid });
  }

  async stop(pluginId: string): Promise<void> {
    const proc = this.procs.get(pluginId);
    if (!proc) return;
    proc.intentionalStop = true;
    proc.child.send({ type: 'shutdown' });
    // Force-terminate if it doesn't exit promptly.
    const child = proc.child;
    setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM');
    }, 3000).unref?.();
  }

  /** Handles messages from a plugin process, enforcing permissions. */
  private async onMessage(proc: HostProc, msg: unknown): Promise<void> {
    const m = msg as { type?: string; id?: number; method?: string; args?: Record<string, unknown>; event?: string; data?: unknown; message?: string };
    if (m.type === 'log') {
      this.emitEvent(proc.pluginId, 'log', { message: m.message });
      return;
    }
    if (m.type === 'event') {
      this.emitEvent(proc.pluginId, 'host', { message: `event:${m.event}` });
      return;
    }
    if (m.type === 'host-call' && typeof m.id === 'number') {
      try {
        const result = await this.handleHostCall(proc, m.method ?? '', m.args ?? {});
        proc.child.send({ type: 'host-reply', id: m.id, ok: true, result });
      } catch (err) {
        proc.child.send({ type: 'host-reply', id: m.id, ok: false, error: (err as Error).message });
      }
    }
  }

  private requirePermission(proc: HostProc, permission: RuntimePermissionKey): void {
    if (!proc.permissions.has(permission)) {
      throw new Error(`Permission "${permission}" not granted`);
    }
  }

  private async handleHostCall(proc: HostProc, method: string, args: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'notify': {
        this.requirePermission(proc, 'notifications');
        const title = String(args.title ?? proc.pluginId);
        const body = String(args.body ?? '');
        if (Notification.isSupported()) new Notification({ title, body }).show();
        return { shown: Notification.isSupported() };
      }
      case 'storage.get': {
        const kv = await readKv(proc.pluginId);
        return kv[String(args.key)] ?? null;
      }
      case 'storage.set': {
        const kv = await readKv(proc.pluginId);
        kv[String(args.key)] = args.value;
        await writeKv(proc.pluginId, kv);
        return { ok: true };
      }
      case 'runModel': {
        this.requirePermission(proc, 'local_models');
        // Declared capability seam: no local model runtime is wired yet.
        return { ok: false, reason: 'no_local_model_configured', echo: String(args.prompt ?? '') };
      }
      default:
        throw new Error(`Unknown host method: ${method}`);
    }
  }
}

export const pluginHost = new PluginHost();
