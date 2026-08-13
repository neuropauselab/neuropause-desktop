/**
 * Phase 6 — Universal Enterprise Data Plane: minimal XML scanner.
 *
 * Scoped to machine-generated OOXML (xlsx worksheet/sharedStrings/workbook,
 * docx document.xml), NOT a general-purpose XML parser. It is a forward
 * scanner over non-nesting elements, which is exactly the shape OOXML uses for
 * the parts we read (`<row>`, `<c>`, `<si>`, `<w:p>`).
 *
 * Deliberately does not resolve DTDs, entities beyond the XML five, or external
 * references — an XXE surface we simply refuse to have.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decode the five XML entities plus numeric character references. */
export function decodeXml(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/** Parse the attribute list out of a start-tag body. */
export function parseAttrs(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"|([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*'([^']*)'/g;
  let m = re.exec(tagBody);
  while (m !== null) {
    const key = m[1] ?? m[3];
    const value = m[2] ?? m[4];
    if (key !== undefined && value !== undefined) attrs[key] = decodeXml(value);
    m = re.exec(tagBody);
  }
  return attrs;
}

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  /** Raw inner XML (undecoded). Empty for self-closing elements. */
  inner: string;
}

/**
 * Iterate every occurrence of `<name ...>...</name>` (and `<name ... />`) in
 * document order. Assumes the element does not nest inside itself — true for
 * every OOXML element this subsystem reads.
 */
export function eachElement(xml: string, name: string, visit: (el: XmlElement) => void): void {
  const open = new RegExp(`<${name}(\\s[^>]*?)?(/?)>`, 'g');
  const close = `</${name}>`;
  let m = open.exec(xml);
  while (m !== null) {
    const attrs = parseAttrs(m[1] ?? '');
    if (m[2] === '/') {
      visit({ name, attrs, inner: '' });
      m = open.exec(xml);
      continue;
    }
    const start = m.index + m[0].length;
    const end = xml.indexOf(close, start);
    if (end === -1) {
      // Unterminated element — stop rather than mis-attribute the remainder.
      return;
    }
    visit({ name, attrs, inner: xml.slice(start, end) });
    open.lastIndex = end + close.length;
    m = open.exec(xml);
  }
}

/** Concatenate the decoded text of every `<tag>` in a fragment (e.g. every `<t>` in an `<si>`). */
export function textOf(xml: string, tag: string): string {
  let out = '';
  eachElement(xml, tag, (el) => {
    out += decodeXml(el.inner);
  });
  return out;
}

/** Strip every tag, returning decoded text content. Used for docx paragraph fallback. */
export function stripTags(xml: string): string {
  return decodeXml(xml.replace(/<[^>]*>/g, ''));
}
