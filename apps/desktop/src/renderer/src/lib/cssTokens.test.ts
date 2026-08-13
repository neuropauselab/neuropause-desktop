/**
 * Every `var(--token)` a component references must actually be DEFINED.
 *
 * This exists because of a real bug that shipped: a full-screen first-run
 * overlay styled `[background:var(--surface-0)]`. There is no `--surface-0` —
 * the tokens are `--surface-1` / `--surface-2` — so the declaration resolved
 * to nothing, the overlay rendered fully transparent, and the welcome copy
 * composited on top of the app underneath. Both were unreadable.
 *
 * Nothing caught it: TypeScript does not read CSS, ESLint does not read
 * Tailwind arbitrary values, and the string is valid CSS syntax. The only
 * signal was looking at the running app. This test is that signal, made
 * automatic — a typo'd token now fails the suite instead of the screen.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RENDERER_SRC = join(__dirname, '..');
const INDEX_CSS = join(RENDERER_SRC, 'index.css');

/** Tokens defined anywhere in the stylesheet (`--name:` declarations). */
function definedTokens(): Set<string> {
  const css = readFileSync(INDEX_CSS, 'utf8');
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
}

/** Every `var(--token)` reference in .ts/.tsx under the renderer, with source. */
function referencedTokens(dir: string, out: { token: string; file: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      referencedTokens(path, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue;
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/var\((--[a-z0-9-]+)/gi)) {
      // P13C ROUND 17k — `/` on every platform, so a failure message reads the same
      // on Windows as it does here.
      out.push({ token: match[1], file: path.slice(RENDERER_SRC.length + 1).replace(/\\/g, '/') });
    }
  }
  return out;
}

/**
 * Empty, and it must stay that way.
 *
 * This list previously held 21 tokens that were referenced across 20 screens
 * but never defined — every one a dead declaration. They were resolved by
 * defining the aliases in `index.css` rather than editing twenty unfamiliar
 * surfaces: the intent of each reference was unambiguous, and one definition
 * cannot introduce a layout regression the way twenty edits could.
 *
 * The escape hatch is kept because there may one day be a genuine reason to
 * reference a token defined outside this stylesheet. There is no such reason
 * today, so anything appearing here needs to come with one.
 */
const KNOWN_BROKEN_TOKENS: readonly string[] = [];

describe('CSS custom properties referenced by components', () => {
  it('introduces no NEW undefined variable', () => {
    const defined = definedTokens();
    const allowed = new Set(KNOWN_BROKEN_TOKENS);
    const unknown = referencedTokens(RENDERER_SRC).filter(
      (r) => !defined.has(r.token) && !allowed.has(r.token),
    );
    // Reported as file → token so a failure names the line to fix, not just
    // the count. An unresolved token is invisible at runtime, so the message
    // has to carry everything needed to act on it.
    expect(
      [...new Set(unknown.map((u) => `${u.file}: var(${u.token})`))],
      'These CSS variables are referenced by components but never defined — the declaration silently does nothing at runtime.',
    ).toEqual([]);
  });

  it('the known-broken list only shrinks — no entry outlives its fix', () => {
    const defined = definedTokens();
    const referenced = new Set(referencedTokens(RENDERER_SRC).map((r) => r.token));
    // An entry that is now defined, or no longer referenced anywhere, has been
    // dealt with and must be deleted from the list. Otherwise the baseline
    // quietly re-authorises a token someone reintroduces later.
    const stale = KNOWN_BROKEN_TOKENS.filter((t) => defined.has(t) || !referenced.has(t));
    expect(stale, 'Remove these from KNOWN_BROKEN_TOKENS — they are fixed.').toEqual([]);
  });

  it('the stylesheet actually defines the surface tokens components rely on', () => {
    const defined = definedTokens();
    // A spot-check on the tokens that carry OPACITY. If one of these ever
    // disappears, panels and overlays go transparent rather than merely
    // off-colour, which is the failure that is hardest to notice in review.
    for (const token of ['--glass', '--surface-1', '--surface-2', '--hairline', '--fill-1']) {
      expect(defined.has(token), `${token} must stay defined`).toBe(true);
    }
  });
});
