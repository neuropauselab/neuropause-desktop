/**
 * Web runtime adapter. Web apps are hosted inside the NeuroPause renderer as
 * Workspace tabs, so "launching" means asking the renderer to open a tab for
 * the app, and lifecycle transitions are tracked in the main process. This path
 * is fully functional today.
 *
 * Resource sampling uses Electron's built-in app.getAppMetrics() to report the
 * renderer's live CPU/memory. Web apps share the single renderer process, so
 * the figure reflects the shared surface rather than a per-app slice.
 */
import { app } from 'electron';
import type { AppType, ResourceSample } from '@neuropause/shared';
import type { LaunchContext, RuntimeAdapter, RuntimeInstance } from '../types';
import { nowSample } from '../types';

export class WebRuntimeAdapter implements RuntimeAdapter {
  readonly kinds: readonly AppType[] = ['web'];

  async launch(ctx: LaunchContext): Promise<void> {
    ctx.openApp({
      appSlug: ctx.instance.slug,
      appName: ctx.instance.name,
      launchUrl: ctx.instance.launchUrl,
      instanceId: ctx.instance.instanceId,
    });
    ctx.emit({ type: 'lifecycle', status: 'running', health: 'healthy', message: 'Opened in workspace' });
  }

  async stop(instance: RuntimeInstance): Promise<void> {
    instance.status = 'stopped';
  }

  async suspend(instance: RuntimeInstance): Promise<void> {
    // Renderer-hosted tabs cannot be OS-suspended; we mark intent and pause sync.
    instance.status = 'suspended';
  }

  async resume(instance: RuntimeInstance): Promise<void> {
    instance.status = 'running';
  }

  async sampleResource(_instance: RuntimeInstance): Promise<ResourceSample | null> {
    try {
      const metrics = app.getAppMetrics();
      const renderers = metrics.filter((m) => m.type === 'Tab');
      if (!renderers.length) return null;
      const cpu = renderers.reduce((sum, m) => sum + (m.cpu?.percentCPUUsage ?? 0), 0);
      const memKb = renderers.reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0);
      return nowSample(Math.round(cpu * 10) / 10, Math.round((memKb / 1024) * 10) / 10);
    } catch {
      return null;
    }
  }
}
