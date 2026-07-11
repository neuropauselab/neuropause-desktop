/**
 * AI Sandbox — Enterprise Scenario Runner (S3): variable scope + interpolation.
 *
 * A scenario threads state between steps through named variables — a created record's
 * id captured with `saveAs`, scenario `variables`, and the active dataset row. Steps
 * reference them with `${name}` / `${name.field}` tokens in any string in their input.
 * Pure string/tree substitution; no evaluation.
 */
export class VariableScope {
  private readonly bag: Record<string, unknown>;

  constructor(initial: Record<string, unknown> = {}) {
    this.bag = { ...initial };
  }

  set(name: string, value: unknown): void {
    this.bag[name] = value;
  }
  get(name: string): unknown {
    return this.bag[name];
  }
  all(): Record<string, unknown> {
    return { ...this.bag };
  }

  /** Deep-substitute `${path}` tokens in any string within `input`. */
  resolve<T>(input: T): T {
    return this.walk(input) as T;
  }

  private walk(value: unknown): unknown {
    if (typeof value === 'string') return this.substitute(value);
    if (Array.isArray(value)) return value.map((v) => this.walk(v));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = this.walk(v);
      return out;
    }
    return value;
  }

  private substitute(str: string): unknown {
    // A whole-string single token resolves to the raw value (preserving type).
    const whole = str.match(/^\$\{([^}]+)\}$/);
    if (whole) {
      const resolved = this.lookup(whole[1].trim());
      return resolved === undefined ? str : resolved;
    }
    // Embedded tokens are stringified in place.
    return str.replace(/\$\{([^}]+)\}/g, (_m, path: string) => {
      const v = this.lookup(path.trim());
      return v === undefined ? '' : String(typeof v === 'object' ? JSON.stringify(v) : v);
    });
  }

  private lookup(path: string): unknown {
    const parts = path.split('.');
    let cur: unknown = this.bag[parts[0]];
    for (let i = 1; i < parts.length && cur != null; i += 1) {
      cur = (cur as Record<string, unknown>)[parts[i]];
    }
    return cur;
  }
}
