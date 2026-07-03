/** Handlers for app-level IPC (metadata + theme control). */
import { app, BrowserWindow, nativeTheme } from 'electron';
import type { AppInfo } from '@neuropause/shared';
import type { SetThemeSourceRequest, ThemeSource } from '@neuropause/shared';

export function getAppInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    platform: process.platform,
    isPackaged: app.isPackaged,
  };
}

export function getThemeSource(): ThemeSource {
  return nativeTheme.themeSource;
}

export function setThemeSource(payload: SetThemeSourceRequest): ThemeSource {
  // nativeTheme drives the OS-level light/dark hint; the renderer mirrors it.
  nativeTheme.themeSource = payload.source;
  return nativeTheme.themeSource;
}

/** Closes the focused window (used by the ⌘W fallback when no tab is open). */
export function closeWindow(): void {
  (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.close();
}
