/**
 * Two whole-renderer audits that no other tool performs.
 *
 * ESLint checks syntax, TypeScript checks types, and neither has any opinion
 * about a class string. That leaves two entire defect classes invisible until
 * someone notices the app behaving badly:
 *
 *  1. A control that removes the browser's focus outline and puts nothing in
 *     its place. It looks fine with a mouse and is unusable with a keyboard —
 *     which is exactly the combination that survives review.
 *  2. An animation that drives a layout property. It looks fine on a fast
 *     machine with three items on screen and drops frames on a real dataset.
 *
 * Both use an explicit allowlist rather than a blanket ban, because a few
 * cases are genuinely justified. The point is that a justified exception is
 * DECLARED here, in one place, with a reason — not discovered later in a
 * profiler.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RENDERER_SRC = join(__dirname, '..');

function sourceFiles(dir: string, out: { path: string; source: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    out.push({ path: path.slice(RENDERER_SRC.length + 1), source: readFileSync(path, 'utf8') });
  }
  return out;
}

describe('focus visibility', () => {
  it('no file removes the focus outline without providing a replacement', () => {
    // File-level rather than element-level on purpose: the ring often comes
    // from a shared variant map (Button's VARIANTS), so an element-level scan
    // reports false positives on exactly the components that do it right.
    const offenders = sourceFiles(RENDERER_SRC)
      .filter(
        (f) =>
          f.source.includes('outline-none') &&
          !f.source.includes('focus-visible:') &&
          !f.source.includes('focus:'),
      )
      .map((f) => f.path);
    expect(
      offenders,
      'These files strip the browser focus ring and never replace it — the controls are invisible to keyboard users. Add `focus-visible:shadow-focus`.',
    ).toEqual([]);
  });

  it('the `shadow-focus` utility those fixes rely on actually exists', () => {
    // Every one of the 40+ `focus-visible:shadow-focus` fixes resolves to this
    // single boxShadow token. If it were renamed or dropped, Tailwind would
    // emit nothing for the class — no error anywhere, and every focus ring in
    // the app would quietly disappear at once.
    const config = readFileSync(join(RENDERER_SRC, '..', '..', '..', 'tailwind.config.ts'), 'utf8');
    expect(config, 'tailwind boxShadow.focus is gone — every focus ring silently stops rendering').toMatch(
      /boxShadow[\s\S]*?\bfocus:\s*'/,
    );
  });
});

/**
 * Layout animation that is genuinely the right call.
 *
 * Each entry needs a reason, because the default answer is "use transform".
 * THIS LIST MAY ONLY SHRINK without a stated justification.
 */
const JUSTIFIED_LAYOUT_ANIMATIONS: Record<string, string> = {
  'shell/Sidebar.tsx':
    'The sidebar collapse genuinely changes the layout — the content region resizes with it. A transform would slide the rail over the content instead of making room, which is a different (wrong) behaviour.',
  'understanding/UnderstandView.tsx':
    'Expand-to-auto-height for the Add panel and attribute rows. The target height is unknown until content renders, so transform cannot express it. Single element, user-triggered, one at a time.',
  'understanding/HoldsView.tsx':
    'Expand-to-auto-height for the Decision Record evidence. Same reasoning: height is content-derived, and collapsing it into a scaleY would squash the text.',
};

describe('frame budget', () => {
  const LAYOUT_PROPS = ['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding'];

  it('no undeclared framer-motion target animates a layout property', () => {
    const offenders: string[] = [];
    for (const { path, source } of sourceFiles(RENDERER_SRC)) {
      if (JUSTIFIED_LAYOUT_ANIMATIONS[path]) continue;
      for (const match of source.matchAll(/(initial|animate|exit)=\{\{([^}]*)\}\}/g)) {
        for (const prop of LAYOUT_PROPS) {
          if (new RegExp(`\\b${prop}\\s*:`).test(match[2])) {
            offenders.push(`${path}: ${match[1]} animates "${prop}"`);
          }
        }
      }
    }
    expect(
      [...new Set(offenders)],
      'Animating a layout property forces layout on every frame. Use transform/opacity, or add a justification to JUSTIFIED_LAYOUT_ANIMATIONS.',
    ).toEqual([]);
  });

  it('nothing uses `transition-all`', () => {
    // `transition-all` animates every property that changes, including layout
    // ones the author never intended — it is a layout animation waiting to
    // happen the next time someone adds a padding change on hover.
    const offenders = sourceFiles(RENDERER_SRC)
      .filter((f) => /\btransition-all\b/.test(f.source))
      .map((f) => f.path);
    expect(
      offenders,
      'Replace `transition-all` with an explicit property list so a future style change cannot silently start animating layout.',
    ).toEqual([]);
  });

  it('every justified exception still exists — no stale entries', () => {
    const paths = new Set(sourceFiles(RENDERER_SRC).map((f) => f.path));
    const stale = Object.keys(JUSTIFIED_LAYOUT_ANIMATIONS).filter((p) => !paths.has(p));
    expect(stale, 'Remove these from JUSTIFIED_LAYOUT_ANIMATIONS — the files are gone.').toEqual([]);
  });
});
