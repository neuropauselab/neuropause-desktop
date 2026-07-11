/**
 * Tiny, dependency-free argument parsing for the CLI. Splits an argv tail into
 * ordered positionals and `--flag`/`--flag value`/`--flag=value` options, and
 * turns the leftover flags into a gateway query record (numeric strings coerced).
 * Pure — no process/env access — so the dispatcher stays unit-testable.
 */

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const rest = a.slice(2);
      const eq = rest.indexOf('=');
      if (eq !== -1) {
        flags[rest.slice(0, eq)] = rest.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[rest] = next;
        i += 1;
      } else {
        flags[rest] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

/**
 * Turn flags into a gateway query record: control flags in `omit` are dropped,
 * boolean flags pass through, and numeric strings are coerced to numbers so the
 * gateway receives real integers for `limit`, `depth`, `windowDays`, …
 */
export function queryFromFlags(
  flags: Record<string, string | boolean>,
  omit: readonly string[] = [],
): Record<string, string | number | boolean> {
  const q: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(flags)) {
    if (omit.includes(k)) continue;
    if (typeof v === 'boolean') {
      q[k] = v;
    } else if (/^-?\d+(\.\d+)?$/.test(v) && Number.isFinite(Number(v))) {
      q[k] = Number(v);
    } else {
      q[k] = v;
    }
  }
  return q;
}
