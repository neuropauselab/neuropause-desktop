/**
 * AI Sandbox — Desktop Automation (S2): capture → Sandbox artifacts.
 *
 * Turns real captures (screenshot bytes, console + network buffers) into S1 artifacts
 * — it writes screenshot PNG bytes to the run's artifact dir and records every capture
 * through the injected S1 `attachArtifact` sink (kind screenshot / log). It NEVER
 * fabricates a capture: a screenshot is the driver's real PNG; console/network come
 * from the driver's buffers. No duplicate artifact store — everything lands in S1's.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Artifact, ArtifactKind } from '@neuropause/shared';
import type { DesktopSession, DesktopWindow } from './driver';

/** The S1 `ctx.attachArtifact` shape (kept structural to avoid a hard import cycle). */
export type AttachArtifact = (input: {
  kind: ArtifactKind;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  storageRef?: string | null;
  inline?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}) => Artifact;

export interface CaptureDeps {
  /** Directory this run's binary artifacts are written under. */
  artifactsDir: string;
  attach: AttachArtifact;
  now: () => number;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'capture';
}

/** Capture a real screenshot, persist the PNG bytes, and record the artifact. */
export async function captureScreenshot(
  window: DesktopWindow,
  name: string,
  deps: CaptureDeps,
  opts: { fullPage?: boolean } = {},
): Promise<{ artifact: Artifact; ms: number }> {
  const started = deps.now();
  const bytes = await window.screenshot(opts);
  const ms = deps.now() - started;
  await fs.mkdir(deps.artifactsDir, { recursive: true }).catch(() => undefined);
  const file = join(deps.artifactsDir, `${safeName(name)}-${deps.now()}.png`);
  await fs.writeFile(file, bytes, { mode: 0o600 });
  const artifact = deps.attach({
    kind: 'screenshot',
    name: `${name}.png`,
    mimeType: 'image/png',
    sizeBytes: bytes.length,
    storageRef: file,
    metadata: { fullPage: opts.fullPage ?? false },
  });
  return { artifact, ms };
}

/** Attach the session's buffered console messages as a `log` artifact. */
export function captureConsole(session: DesktopSession, deps: CaptureDeps): Artifact | null {
  const messages = session.consoleMessages();
  if (messages.length === 0) return null;
  const inline = messages.map((m) => `[${new Date(m.at).toISOString()}] ${m.level.toUpperCase()} ${m.text}`).join('\n');
  return deps.attach({ kind: 'log', name: 'console.log', mimeType: 'text/plain', inline, metadata: { messages: messages.length } });
}

/** Attach the session's buffered network activity as a `log` artifact. */
export function captureNetwork(session: DesktopSession, deps: CaptureDeps): Artifact | null {
  const messages = session.networkMessages();
  if (messages.length === 0) return null;
  const inline = messages.map((m) => `[${new Date(m.at).toISOString()}] ${m.method} ${m.status ?? '—'} ${m.url}`).join('\n');
  return deps.attach({ kind: 'log', name: 'network.log', mimeType: 'text/plain', inline, metadata: { requests: messages.length } });
}
