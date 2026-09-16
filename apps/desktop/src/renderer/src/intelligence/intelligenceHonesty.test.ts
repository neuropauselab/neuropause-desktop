import { describe, expect, it } from 'vitest';
import { emptyGraphNotice } from './intelligenceHonesty';

// NP-008 F-N8-2 — the derivation pin (UI truth rule): the empty-substrate notice
// appears exactly when the graph is empty, and never rewrites the scores.
describe('emptyGraphNotice', () => {
  it('states the absence of evidence when the graph has 0 nodes', () => {
    expect(emptyGraphNotice(0)).toMatch(/empty enterprise graph/);
    expect(emptyGraphNotice(0)).toMatch(/no evidence behind these scores/);
  });

  it('renders nothing once real substrate exists', () => {
    expect(emptyGraphNotice(1)).toBeNull();
    expect(emptyGraphNotice(133)).toBeNull();
  });
});
