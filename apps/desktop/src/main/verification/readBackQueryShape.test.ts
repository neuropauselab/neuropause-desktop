/**
 * FG-15 — THE READ-BACK'S QUERY SHAPE, PINNED AGAINST ITS CONSUMERS.
 *
 * ── THE SELF-AVOIDANCE CLAUSE, WHICH IS THE CONDITION OF THIS FILE'S EXISTENCE ────────────────────────────────
 * **A pin that copies the adapter's own string asserts only that the string equals itself.** So this file never
 * writes the expected URL down. It DERIVES the required field set from the **consumer's own source** —
 * `verifyEffect.ts`'s `SentItem` and `InboxItem` interfaces — and asserts the adapter's `$select` covers it.
 *
 * The consequence is the point: **add a field to `SentItem` and this pin goes red until `$select` requests it.**
 * The requirement flows consumer → adapter, which is the only direction that can catch the real defect.
 *
 * ── THE FALSIFICATION GAP THIS CLOSES ────────────────────────────────────────────────────────────────────────
 * `e2e/mockGraph.ts` dispatches on a **folder-path regex** and parses no `$select`. So today: drop
 * `internetMessageId` from the adapter's `$select` and the mock still hands it back, `mockGraph.test.ts` stays
 * green, both e2e runners stay green — **and in production every verification silently degrades to UNKNOWN**,
 * because the corroboration id the oracle needs was never requested. A green suite reporting on a request the
 * product no longer sends. The mock cannot notice; this file can.
 *
 * NO EXTERNAL EFFECT: pure string construction and source reads. No network, no credentials, no vault, no Graph.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inboxQuery, sentItemsQuery } from './m365ReadBack';

/** Read an interface's field names from the CONSUMER's source — never from the adapter's. */
function consumerFields(interfaceName: string): string[] {
  const src = readFileSync(join(__dirname, 'verifyEffect.ts'), 'utf8');
  const start = src.indexOf(`export interface ${interfaceName} {`);
  expect(start, `${interfaceName} must exist in verifyEffect.ts`).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('}', start));
  return [...body.matchAll(/readonly\s+(\w+)\s*:/g)].map((m) => m[1]);
}

const selectOf = (url: string): string[] => (new URL(url).searchParams.get('$select') ?? '').split(',');

describe('FG-15 · the adapter must REQUEST what the read-back CONSUMES', () => {
  it('SENT ITEMS — $select covers every field SentItem declares (derived from verifyEffect.ts, not copied)', () => {
    const required = consumerFields('SentItem');
    // Guard against a vacuous pass if the interface is ever emptied or the parse silently fails.
    expect(required.length).toBeGreaterThanOrEqual(5);
    expect(required).toContain('internetMessageId'); // the corroboration id — absent ⇒ every terminal is UNKNOWN
    expect(required).toContain('sentDateTime'); // NP-015: an untimeable row cannot corroborate

    const selected = selectOf(sentItemsQuery());
    for (const field of required) expect(selected, `$select must request ${field}`).toContain(field);
  });

  it('INBOX — $select covers every field InboxItem declares (bounce detection)', () => {
    const required = consumerFields('InboxItem');
    expect(required.length).toBeGreaterThanOrEqual(4);

    const selected = selectOf(inboxQuery());
    for (const field of required) expect(selected, `$select must request ${field}`).toContain(field);
  });

  it('THE FOLDERS — send-corroboration reads Sent Items, bounce detection reads Inbox', () => {
    // A mailbox-wide read would corroborate against the wrong population; the folder IS part of the claim.
    expect(new URL(sentItemsQuery()).pathname).toContain('/mailFolders/sentitems/messages');
    expect(new URL(inboxQuery()).pathname).toContain('/mailFolders/inbox/messages');
  });

  it('BOUNDED — $top is present and bounded, so a reconciliation tick cannot become an unbounded read', () => {
    for (const url of [sentItemsQuery(), inboxQuery()]) {
      const top = Number(new URL(url).searchParams.get('$top'));
      expect(Number.isInteger(top)).toBe(true);
      expect(top).toBeGreaterThan(0);
      expect(top).toBeLessThanOrEqual(100);
    }
  });

  it('ORDERED BY ITS OWN TIME FIELD — the bounded-interval reasoning assumes recency ordering', () => {
    // requestTime ≤ effect ≤ at is only usable if the newest rows are the ones returned.
    expect(new URL(sentItemsQuery()).searchParams.get('$orderby')).toBe('sentDateTime desc');
    expect(new URL(inboxQuery()).searchParams.get('$orderby')).toBe('receivedDateTime desc');
  });

  it('NO CREDENTIAL IN THE URL — the token rides in a header, and a URL is a logged surface', () => {
    // NP-013's boundary: `redactCredentialText` protects log TEXT; the cheapest guarantee is that the secret
    // never enters the string at all. The adapter sets `Authorization: Bearer` on the request headers.
    for (const url of [sentItemsQuery(), inboxQuery()]) {
      expect(url).not.toMatch(/bearer|access_?token|token=|Authorization/i);
    }
    const adapter = readFileSync(join(__dirname, 'm365ReadBack.ts'), 'utf8');
    expect(adapter).toContain('Authorization: `Bearer ${tokens.accessToken}`');
  });

  it('PURE — the builders take no input and are stable across calls, so the pin cannot be state-dependent', () => {
    expect(sentItemsQuery()).toBe(sentItemsQuery());
    expect(inboxQuery()).toBe(inboxQuery());
    expect(sentItemsQuery()).not.toBe(inboxQuery());
  });

  /**
   * THE LOAD-BEARING CHECK. Without this, every assertion above could pass against a mock that ignores the query
   * — which is exactly today's situation and exactly why the seam was cut. This asserts the GAP still exists, so
   * if someone teaches the mock to honour `$select`, this test goes red and says the pin's rationale changed.
   */
  it('DOCUMENTS THE GAP — mockGraph still parses no $select, so it cannot falsify any of the above', () => {
    const mock = readFileSync(join(__dirname, '..', 'e2e', 'mockGraph.ts'), 'utf8');
    expect(mock).not.toContain('$select');
    expect(mock).toMatch(/mailFolders\\\/sentitems\\\/messages/); // dispatch is a folder-path regex, nothing more
  });
});
