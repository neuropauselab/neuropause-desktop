/**
 * Process runtime adapter. Handles app kinds that run as their own OS process:
 * Electron apps, native apps, AI agents, MCP servers, and automation workers.
 *
 * The lifecycle is real: it spawns a child process, tracks its pid, forwards
 * stdout/stderr to the log, detects unexpected exits as crashes, and supports
 * pause/resume via POSIX SIGSTOP/SIGCONT and stop via SIGTERM. What it cannot
 * invent is an executable: catalog entries for hosted/third-party apps carry no
 * local binary, so launching one without a configured entry command returns a
 * clear "no executable entry point" result. The moment a package ships a real
 * runnable artifact (or a dev points an entry at a command), this path runs it.
 */
import { spawn } from 'node:child_process';
import type { AppType, ResourceSample } from '@neuropause/shared';
import type { LaunchContext, RuntimeAdapter, RuntimeInstance } from '../types';
import { createLogger } from '../../logger';

const log = createLogger('runtime:process');

interface EntrySpec {
  command: string;
  args: string[];
  cwd?: string;
}

/** Reads a runnable entry from the registry entry config, if one is configured. */
function resolveEntry(ctx: LaunchContext): EntrySpec | null {
  const cfg = ctx.entry.config as Record<string, unknown>;
  const command = typeof cfg.entryCommand === 'string' ? cfg.entryCommand : null;
  if (!command) return null;
  const args = Array.isArray(cfg.entryArgs) ? (cfg.entryArgs as unknown[]).map(String) : [];
  const cwd = typeof cfg.entryCwd === 'string' ? cfg.entryCwd : ctx.entry.installLocation ?? undefined;
  return { command, args, cwd };
}

export class ProcessRuntimeAdapter implements RuntimeAdapter {
  readonly kinds: readonly AppType[] = [
    'electron',
    'native',
    'ai_agent',
    'mcp_server',
    'automation',
    'desktop_plugin',
  ];

  async launch(ctx: LaunchContext): Promise<void> {
    const entry = resolveEntry(ctx);
    if (!entry) {
      throw new Error(
        `No executable entry point configured for ${ctx.instance.slug}. ` +
          'This app kind runs as a local process; provide a packaged artifact or dev entry command to launch it.',
      );
    }

    const child = spawn(entry.command, entry.args, {
      cwd: entry.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    ctx.instance.child = child;
    ctx.instance.pid = child.pid ?? null;

    child.stdout?.on('data', (d: Buffer) =>
      ctx.emit({ type: 'log', status: null, health: null, message: d.toString().trim() }),
    );
    child.stderr?.on('data', (d: Buffer) =>
      ctx.emit({ type: 'log', status: null, health: null, message: d.toString().trim() }),
    );

    child.on('exit', (code, signal) => {
      if (ctx.instance.intentionalStop) {
        ctx.instance.status = 'stopped';
        ctx.emit({ type: 'lifecycle', status: 'stopped', health: 'unknown', message: 'Stopped' });
        return;
      }
      const crashed = code !== 0;
      ctx.instance.status = crashed ? 'crashed' : 'stopped';
      ctx.instance.lastError = crashed ? `Exited with ${signal ?? code}` : null;
      ctx.emit({
        type: crashed ? 'crash' : 'lifecycle',
        status: ctx.instance.status,
        health: crashed ? 'unhealthy' : 'unknown',
        message: crashed ? `Process crashed (${signal ?? code})` : 'Process exited',
      });
    });

    child.on('error', (err) => {
      ctx.instance.status = 'failed';
      ctx.instance.lastError = err.message;
      ctx.emit({ type: 'crash', status: 'failed', health: 'unhealthy', message: err.message });
    });

    log.info('Spawned process', { slug: ctx.instance.slug, pid: child.pid });
    ctx.emit({ type: 'lifecycle', status: 'running', health: 'healthy', message: 'Process started' });
  }

  async stop(instance: RuntimeInstance): Promise<void> {
    instance.intentionalStop = true;
    if (instance.child && instance.pid) {
      instance.child.kill('SIGTERM');
    }
  }

  async suspend(instance: RuntimeInstance): Promise<void> {
    if (instance.pid) {
      try {
        process.kill(instance.pid, 'SIGSTOP');
        instance.status = 'suspended';
      } catch (err) {
        log.warn('Suspend failed', { pid: instance.pid, message: (err as Error).message });
      }
    }
  }

  async resume(instance: RuntimeInstance): Promise<void> {
    if (instance.pid) {
      try {
        process.kill(instance.pid, 'SIGCONT');
        instance.status = 'running';
      } catch (err) {
        log.warn('Resume failed', { pid: instance.pid, message: (err as Error).message });
      }
    }
  }

  async sampleResource(instance: RuntimeInstance): Promise<ResourceSample | null> {
    // Liveness is checkable cross-platform; precise per-pid CPU/memory for an
    // arbitrary native child needs a platform probe and is left as a seam.
    if (!instance.pid) return null;
    try {
      process.kill(instance.pid, 0); // throws if the process is gone
      return { cpuPercent: null, memoryMb: null, sampledAt: new Date().toISOString() };
    } catch {
      return null;
    }
  }
}
