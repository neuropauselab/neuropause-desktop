/**
 * AI Sandbox — Desktop Automation (S2): window manager.
 *
 * Thin, driver-agnostic helpers over a {@link DesktopSession} for the multi-window
 * needs of a scenario — enumerate every open window (main, dialogs, settings, plugin
 * / auth / OAuth child windows), switch the active target, and screenshot a specific
 * window. Reused by the executor; no Playwright here (it goes through the port).
 */
import type { DesktopWindowInfo } from '@neuropause/shared';
import type { DesktopSession, DesktopWindow } from './driver';

export async function enumerateWindows(session: DesktopSession): Promise<DesktopWindowInfo[]> {
  const windows = await session.windows();
  return Promise.all(
    windows.map(async (w, index): Promise<DesktopWindowInfo> => ({ id: w.id, index, title: await w.title(), url: await w.url() })),
  );
}

/** Select a window by index (0 = first) — the "switch active window" primitive. */
export async function selectWindow(session: DesktopSession, index: number): Promise<DesktopWindow | null> {
  const windows = await session.windows();
  return windows[index] ?? null;
}

export async function windowScreenshot(session: DesktopSession, index: number, opts?: { fullPage?: boolean }): Promise<Buffer | null> {
  const window = await selectWindow(session, index);
  return window ? window.screenshot(opts) : null;
}
