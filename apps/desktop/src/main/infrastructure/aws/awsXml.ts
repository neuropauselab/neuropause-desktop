/**
 * A minimal AWS-response XML parser (P6.1). AWS "query" protocol services (EC2, IAM, RDS, ELB, CloudWatch,
 * Auto Scaling) and REST-XML services (S3, Route53) return XML; rather than add a dependency, this parses
 * the well-formed, attribute-light XML AWS emits into a plain object, where a repeated child element becomes
 * an array (so `<Users><member/><member/></Users>` → `{ Users: { member: [ {}, {} ] } }`). Leaf elements
 * collapse to their text. `asArray` normalizes the single-vs-array shape at the call site.
 */

interface RawNode {
  children: Record<string, RawNode[]>;
  text: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function collapse(node: RawNode): unknown {
  const keys = Object.keys(node.children);
  if (keys.length === 0) return node.text;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const arr = node.children[k].map(collapse);
    out[k] = arr.length === 1 ? arr[0] : arr;
  }
  return out;
}

/** Parse AWS XML into a plain object. Returns `{}` on empty/garbage rather than throwing. */
export function parseXml(xml: string): Record<string, unknown> {
  const s = (xml ?? '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const root: RawNode = { children: {}, text: '' };
  const stack: RawNode[] = [root];
  const re = /<(\/?)([A-Za-z0-9_:.-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const closing = m[1];
    const tag = m[2];
    const selfClose = m[4];
    const text = m[5];
    if (text !== undefined) {
      const t = text.trim();
      if (t) stack[stack.length - 1].text += decodeEntities(t);
      continue;
    }
    if (closing) {
      if (stack.length > 1) stack.pop();
    } else {
      const child: RawNode = { children: {}, text: '' };
      const parent = stack[stack.length - 1];
      (parent.children[tag] ??= []).push(child);
      if (!selfClose) stack.push(child);
    }
  }
  return collapse(root) as Record<string, unknown>;
}

/** Normalize a value that may be a single object, an array, or absent into an array. */
export function asArray<T = unknown>(v: unknown): T[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]) as T[];
}

/** Read a nested string path (`a.b.c`) from a parsed object, or null. */
export function xmlGet(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur ?? null;
}
