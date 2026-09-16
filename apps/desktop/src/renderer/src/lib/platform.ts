/**
 * P13C ROUND 36 — GATE 12. THE RENDERER FINALLY KNOWS ITS PLATFORM.
 *
 * The W-2 fix (round 24) gave Windows a standard OS frame — main-process only.
 * The renderer kept hard-coding the macOS chrome assumptions unconditionally:
 * an 80px left toolbar gutter clearing traffic lights that do not exist on
 * Windows, dead-center of every screen. No `process.platform` reaches the
 * sandboxed renderer; `navigator.platform` is stable in Electron and answers
 * the ONLY question chrome layout needs: "are there inset traffic lights?".
 *
 * A function of an injectable string (default: the real navigator) so both
 * branches are testable without stubbing globals.
 */
export function isMacPlatform(platform: string = globalThis.navigator?.platform ?? ''): boolean {
  return platform.startsWith('Mac');
}

/** Computed once — chrome layout does not change mid-session. */
export const IS_MAC = isMacPlatform();
