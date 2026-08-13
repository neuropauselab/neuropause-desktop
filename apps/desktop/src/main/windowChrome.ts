/**
 * P13C ROUND 25 — W-2. THE COMMENT WAS WRONG ABOUT WHAT WINDOWS IGNORES.
 *
 * `createMainWindow` set four appearance options unconditionally, under a
 * comment reading "Ignored on other platforms." Three of them are:
 * `trafficLightPosition`, `vibrancy` and `visualEffectState` are macOS-only and
 * no-ops elsewhere.
 *
 * `titleBarStyle` is NOT. Electron honours it on Windows, where `hiddenInset`
 * degrades to `hidden` — a window with no system title bar and no close,
 * minimise or maximise controls, because the app draws its own set only for the
 * inset-macOS layout and `titleBarOverlay` was never configured. The comment
 * asserted a cross-platform property the API does not have, which is precisely
 * why nobody re-examined it.
 *
 * WHY THIS IS ITS OWN FILE
 *
 * `window.ts` imports `./config`, which reaches `app.getAppPath()` at module
 * scope — so a node test that imports it dies before reaching the assertion.
 * That is the trap this codebase has documented four times over
 * (`automationPlatform/index.ts`: "a subsystem that unit-tests without Electron
 * takes its resolver as a dep"). The platform decision lives here, Electron-free
 * and taking `platform` as an argument, so the property is proven by EXECUTING
 * it rather than by reading the source of the file that uses it.
 */

/** The four appearance options, applied only where they mean something. */
export type MacOsChromeOptions = Pick<
  Electron.BrowserWindowConstructorOptions,
  'titleBarStyle' | 'trafficLightPosition' | 'vibrancy' | 'visualEffectState'
>;

/**
 * macOS chrome for macOS; nothing at all for every other platform.
 *
 * The empty object is deliberate and is the whole fix: an ABSENT
 * `titleBarStyle` is a standard OS frame, which is recoverable. A window
 * without close controls is not.
 */
export function macOsChromeOptions(platform: NodeJS.Platform): MacOsChromeOptions {
  if (platform !== 'darwin') return {};
  return {
    // Keep the native traffic lights but inset them so our custom, draggable
    // title bar can host them.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    // Translucent material behind the UI for the glassmorphism shell.
    vibrancy: 'under-window',
    visualEffectState: 'active',
  };
}
