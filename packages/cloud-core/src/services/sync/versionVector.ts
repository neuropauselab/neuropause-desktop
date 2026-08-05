/**
 * Version vectors for multi-device convergence. A vector maps deviceId -> a
 * monotonic counter. Comparison decides whether one update causally supersedes
 * another or whether they are concurrent (a real conflict to resolve).
 */
export type VersionVector = Record<string, number>;
export type VvOrder = 'equal' | 'dominates' | 'dominated' | 'concurrent';

export function vvCompare(a: VersionVector, b: VersionVector): VvOrder {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aGreater = false;
  let bGreater = false;
  for (const k of keys) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    if (av > bv) aGreater = true;
    else if (av < bv) bGreater = true;
  }
  if (aGreater && bGreater) return 'concurrent';
  if (aGreater) return 'dominates';
  if (bGreater) return 'dominated';
  return 'equal';
}

export function vvMerge(a: VersionVector, b: VersionVector): VersionVector {
  const out: VersionVector = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = Math.max(out[k] ?? 0, v);
  }
  return out;
}
