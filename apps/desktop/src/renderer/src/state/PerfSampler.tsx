/**
 * PerfSampler — the always-mounted, invisible renderer collector. It gathers REAL measurements and
 * publishes an aggregated snapshot (via the pure shared `buildPerfSnapshot`) to `perfStore` once per
 * second. Sources, all real:
 *   • FPS — a requestAnimationFrame frame counter (frames per elapsed second).
 *   • Renderer memory — performance.memory (Chromium/Electron); null when unavailable (never faked).
 *   • IPC latency + in-flight count — from perfRecorder, which the wrapped IPC client feeds.
 *   • Context — real AppInfo (version, packaged), the P1.4 release channel, and enabled feature-flag
 *     counts, fetched once and kept fresh from the updater broadcast.
 * It renders nothing and holds no render-affecting state, so it never triggers shell re-renders.
 */
import { useEffect, useRef } from 'react';
import { buildPerfSnapshot, EMPTY_PERF_CONTEXT, type PerfContext, type PlanTier } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { perfRecorder } from '@renderer/lib/perf/perfRecorder';
import { perfStore } from '@renderer/lib/perf/perfStore';

/** Sampling cadence for memory + snapshot publish. */
const SAMPLE_MS = 1000;
/** How many per-second FPS samples to retain (~rolling window). */
const FPS_WINDOW = 20;

function readMemory(): { used: number | null; limit: number | null } {
  const mem = (
    performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
  ).memory;
  if (!mem) return { used: null, limit: null };
  return { used: mem.usedJSHeapSize, limit: mem.jsHeapSizeLimit };
}

export function PerfSampler(): JSX.Element | null {
  const fpsSamples = useRef<number[]>([]);
  const contextRef = useRef<PerfContext>(EMPTY_PERF_CONTEXT);

  // Real FPS via a requestAnimationFrame frame counter.
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    let alive = true;
    const loop = (now: number): void => {
      frames += 1;
      const elapsed = now - last;
      if (elapsed >= 1000) {
        const fps = (frames * 1000) / elapsed;
        const arr = fpsSamples.current;
        arr.push(fps);
        if (arr.length > FPS_WINDOW) arr.shift();
        frames = 0;
        last = now;
      }
      if (alive) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  // Real, one-time context (version, build type, release channel, enabled flag counts) + live channel.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const info = await ipc.app.getInfo();
        const status = await ipc.updater.getStatus().catch(() => null);
        let flagsEnabled = 0;
        let flagsTotal = 0;
        try {
          const orgs = await ipc.org.list().catch(() => []);
          const active = orgs?.[0] ?? null;
          let tier: PlanTier = 'free';
          if (active) {
            const s = await ipc.license.refresh(active.orgId).catch(() => null);
            tier = s?.evaluation?.entitledPlan ?? 'free';
          }
          const flags = await ipc.flags.get(tier).catch(() => []);
          flagsTotal = flags.length;
          flagsEnabled = flags.filter((f) => f.enabled).length;
        } catch {
          /* best effort — flag counts stay 0 */
        }
        if (!alive) return;
        contextRef.current = {
          appVersion: info.version,
          releaseChannel: status?.channel ?? null,
          isPackaged: info.isPackaged,
          flagsEnabled,
          flagsTotal,
        };
      } catch {
        /* best effort — context stays empty (overlay hidden) */
      }
    })();
    const off = ipc.updater.onEvent((s) => {
      contextRef.current = { ...contextRef.current, releaseChannel: s.channel };
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Publish an aggregated snapshot each second from the real raw buffers.
  useEffect(() => {
    let alive = true;
    const tick = (): void => {
      const raw = perfRecorder.read();
      const mem = readMemory();
      perfStore.publish(
        buildPerfSnapshot({
          fpsSamples: fpsSamples.current.slice(),
          rendererUptimeMs: performance.now(),
          memoryUsedBytes: mem.used,
          memoryLimitBytes: mem.limit,
          ipcDurationsMs: raw.ipcDurationsMs,
          ipcPending: raw.ipcPending,
          ipcChannels: raw.ipcChannels,
          renders: raw.renders,
          renderComponents: raw.renderComponents,
          context: contextRef.current,
        }),
      );
    };
    tick();
    const id = window.setInterval(() => {
      if (alive) tick();
    }, SAMPLE_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
