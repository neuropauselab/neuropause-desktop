/**
 * Tiny className combiner — joins truthy string/conditional class fragments.
 * Avoids a dependency on clsx for what is a very small need.
 */
export type ClassValue = string | number | false | null | undefined;

export function cn(...parts: ClassValue[]): string {
  let out = '';
  for (const p of parts) {
    if (!p && p !== 0) continue;
    out += (out ? ' ' : '') + String(p);
  }
  return out;
}
