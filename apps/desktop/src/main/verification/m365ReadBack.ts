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
      const rows = await get(
        `${GRAPH}/me/mailFolders/sentitems/messages?$top=25&$select=subject,toRecipients,sentDateTime,internetMessageId,bodyPreview&$orderby=sentDateTime%20desc`,
      );
      return rows.map((m) => ({
        internetMessageId: m.internetMessageId ?? null,
        toRecipients: (m.toRecipients ?? []).map(addr).filter(Boolean),
        subject: m.subject ?? '',
        bodyPreview: m.bodyPreview ?? '',
        sentDateTime: m.sentDateTime ?? '',
      }));
    },
    readInbox: async (): Promise<InboxItem[]> => {
      const rows = await get(
        `${GRAPH}/me/mailFolders/inbox/messages?$top=25&$select=subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20desc`,
      );
      return rows.map((m) => ({
        from: addr(m.from),
        subject: m.subject ?? '',
        bodyPreview: m.bodyPreview ?? '',
        receivedDateTime: m.receivedDateTime ?? '',
      }));
    },
  };
}
