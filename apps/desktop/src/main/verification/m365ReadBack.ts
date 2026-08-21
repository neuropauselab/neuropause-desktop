/**
 * NeuroPause OS — Wave 2 / Slice 16. The in-session Microsoft Graph reader that feeds the verification oracle.
 *
 * READ-ONLY: it only GETs Sent Items + Inbox of the connected mailbox to independently verify a governed send. It runs
 * in the app's MAIN process during the operator's live session (DECISIONS D-10), where `connectorVault.get` can decrypt
 * the OAuth token. It never sends, never mutates. Uses `Mail.Read` (already granted — S15 finding F-2).
 */
import { connectorVault } from '../connectors/connectorVault';
import { GRAPH } from '../connectors/m365/actionSdk';
import type { SentItem, InboxItem } from './verifyEffect';

interface GraphRecipient {
  emailAddress?: { address?: string };
}
interface GraphMessage {
  internetMessageId?: string;
  toRecipients?: GraphRecipient[];
  from?: GraphRecipient;
  subject?: string;
  bodyPreview?: string;
  sentDateTime?: string;
  receivedDateTime?: string;
}

const addr = (r?: GraphRecipient): string => r?.emailAddress?.address ?? '';

/**
 * FG-15 — THE REQUESTS, CONSTRUCTIBLE WITHOUT EXECUTING THE READER (F-P49's neighbourhood).
 *
 * These exist so the query shape can be pinned by a contract test with NO network, NO credentials and NO vault
 * stub. Before this seam the URLs were inline template literals inside the async closure, and `get` reaches
 * `connectorVault.get()` BEFORE `fetch` — so observing the constructed request required stubbing two things, and
 * a pin built that way would assert the query shape only through mocks it supplied itself.
 *
 * They are pure: no inputs, no I/O, same string every call. `makeM365GraphReader` below is their only caller, so
 * there is ONE definition of each request and no second copy to drift (F-N16-1's rule — a third copy was refused).
 *
 * THE $select LISTS ARE LOAD-BEARING, NOT DECORATION. Every field named here is CONSUMED by the read-back:
 *   internetMessageId — the corroboration id; absent ⇒ every terminal degrades to UNKNOWN
 *   toRecipients      — a tuple limb in `verifyEffect`
 *   sentDateTime      — read VERBATIM as the provider instant (NP-015); an untimeable row cannot corroborate
 *   subject/bodyPreview — the fingerprints
 * The existing mock cannot protect them: `e2e/mockGraph.ts` dispatches on a folder-path regex and parses no
 * `$select`, so it would keep returning a field the adapter had stopped requesting while every test stayed green.
 */
export function sentItemsQuery(): string {
  return `${GRAPH}/me/mailFolders/sentitems/messages?$top=25&$select=subject,toRecipients,sentDateTime,internetMessageId,bodyPreview&$orderby=sentDateTime%20desc`;
}

export function inboxQuery(): string {
  return `${GRAPH}/me/mailFolders/inbox/messages?$top=25&$select=subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20desc`;
}

/** Build a read-only Graph reader for one connected account. Re-reads the token per call (it may refresh). */
export function makeM365GraphReader(workspaceId: string, connectorId: string, accountId: string): {
  readSentItems: () => Promise<SentItem[]>;
  readInbox: () => Promise<InboxItem[]>;
} {
  const get = async (url: string): Promise<GraphMessage[]> => {
    const tokens = await connectorVault.get(workspaceId, connectorId, accountId);
    if (!tokens) throw new Error('no vault token for the connected account (is the session unlocked?)');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    if (!res.ok) throw new Error(`Graph read failed: HTTP ${res.status}`);
    const json = (await res.json()) as { value?: GraphMessage[] };
    return json.value ?? [];
  };

  return {
    readSentItems: async (): Promise<SentItem[]> => {
      const rows = await get(sentItemsQuery());
      return rows.map((m) => ({
        internetMessageId: m.internetMessageId ?? null,
        toRecipients: (m.toRecipients ?? []).map(addr).filter(Boolean),
        subject: m.subject ?? '',
        bodyPreview: m.bodyPreview ?? '',
        sentDateTime: m.sentDateTime ?? '',
      }));
    },
    readInbox: async (): Promise<InboxItem[]> => {
      const rows = await get(inboxQuery());
      return rows.map((m) => ({
        from: addr(m.from),
        subject: m.subject ?? '',
        bodyPreview: m.bodyPreview ?? '',
        receivedDateTime: m.receivedDateTime ?? '',
      }));
    },
  };
}
