/**
 * NP-008 census F-N8-2. A perfect score computed from zero evidence is a claim
 * the substrate does not support: on a fresh profile the enterprise graph has
 * 0 nodes and every derived score reads 100/100 ("healthy"). The numbers ARE
 * what the engine computed — they are not changed here — but the surface must
 * say what they were computed OVER, or an empty install reads as a certified-
 * healthy enterprise (the S19 truthful-surfaces class).
 */
export function emptyGraphNotice(nodes: number): string | null {
  return nodes === 0
    ? 'Computed over an empty enterprise graph — there is no evidence behind these scores yet.'
    : null;
}
