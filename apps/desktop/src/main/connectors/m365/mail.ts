/**
 * P2.4 — Outlook Mail write actions (live Microsoft Graph, no mocks).
 *
 * send / save draft / reply / reply-all / forward / move / mark read-unread / delete / restore /
 * add attachment / download attachment. Every mutating action is confirmation-gated by the executor.
 */
import {
  GRAPH,
  enc,
  optStr,
  optStrArr,
  optBool,
  quotaFrom,
  recipients,
  str,
  strArr,
  type WriteAction,
  type WriteActionContext,
  type WriteActionResult,
  type WriteParams,
} from './actionSdk';

const RW = 'Mail.ReadWrite';
const SEND = 'Mail.Send';

interface GraphMessageRef {
  id?: string;
}
interface GraphAttachment {
  id?: string;
  name?: string;
  contentBytes?: string;
  contentType?: string;
  size?: number;
}

/** Compose a Graph message body from params (defaults to plain text). */
function messageBody(p: WriteParams): { subject: string; body: { contentType: string; content: string }; toRecipients: ReturnType<typeof recipients>; ccRecipients: ReturnType<typeof recipients>; bccRecipients: ReturnType<typeof recipients> } {
  const contentType = optStr(p, 'bodyType') === 'html' ? 'html' : 'text';
  return {
    subject: optStr(p, 'subject') ?? '(no subject)',
    body: { contentType, content: optStr(p, 'body') ?? '' },
    toRecipients: recipients(strArr(p, 'to')),
    ccRecipients: recipients(optStrArr(p, 'cc')),
    bccRecipients: recipients(optStrArr(p, 'bcc')),
  };
}

async function send(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const message = messageBody(p);
  const res = await ctx.http.postJson(`${GRAPH}/me/sendMail`, {
    message,
    saveToSentItems: optBool(p, 'saveToSentItems', true),
  });
  return {
    ok: true,
    summary: `Sent “${message.subject}” to ${message.toRecipients.length} recipient(s)`,
    quotaRemaining: quotaFrom(res.headers),
  };
}

async function saveDraft(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const res = await ctx.http.postJson<GraphMessageRef>(`${GRAPH}/me/messages`, messageBody(p));
  return { ok: true, summary: `Saved draft “${optStr(p, 'subject') ?? '(no subject)'}”`, data: { id: res.data.id ?? null }, quotaRemaining: quotaFrom(res.headers) };
}

/** reply / replyAll / forward share the same createReply-style POST that sends immediately. */
function replyLike(kind: 'reply' | 'replyAll' | 'forward'): (ctx: WriteActionContext, p: WriteParams) => Promise<WriteActionResult> {
  return async (ctx, p) => {
    const id = str(p, 'messageId');
    const body: Record<string, unknown> = { comment: optStr(p, 'comment') ?? '' };
    if (kind === 'forward') body.toRecipients = recipients(strArr(p, 'to'));
    const res = await ctx.http.postJson(`${GRAPH}/me/messages/${enc(id)}/${kind}`, body);
    return { ok: true, summary: `${kind === 'replyAll' ? 'Replied all to' : kind === 'forward' ? 'Forwarded' : 'Replied to'} message`, data: { messageId: id }, quotaRemaining: quotaFrom(res.headers) };
  };
}

async function move(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'messageId');
  const destinationId = str(p, 'destinationId');
  const res = await ctx.http.postJson<GraphMessageRef>(`${GRAPH}/me/messages/${enc(id)}/move`, { destinationId });
  return { ok: true, summary: `Moved message to ${destinationId}`, data: { id: res.data.id ?? null }, quotaRemaining: quotaFrom(res.headers) };
}

async function restore(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'messageId');
  const destinationId = optStr(p, 'destinationId') ?? 'inbox';
  const res = await ctx.http.postJson<GraphMessageRef>(`${GRAPH}/me/messages/${enc(id)}/move`, { destinationId });
  return { ok: true, summary: `Restored message to ${destinationId}`, data: { id: res.data.id ?? null }, quotaRemaining: quotaFrom(res.headers) };
}

async function mark(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'messageId');
  const isRead = optBool(p, 'isRead', true);
  const res = await ctx.http.patchJson(`${GRAPH}/me/messages/${enc(id)}`, { isRead });
  return { ok: true, summary: `Marked message ${isRead ? 'read' : 'unread'}`, data: { messageId: id, isRead }, quotaRemaining: quotaFrom(res.headers) };
}

async function remove(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'messageId');
  const res = await ctx.http.deleteJson(`${GRAPH}/me/messages/${enc(id)}`);
  return { ok: true, summary: 'Deleted message (moved to Deleted Items)', data: { messageId: id }, quotaRemaining: quotaFrom(res.headers) };
}

async function addAttachment(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'messageId');
  const name = str(p, 'name');
  const contentBytes = str(p, 'contentBytes'); // base64
  const res = await ctx.http.postJson<GraphAttachment>(`${GRAPH}/me/messages/${enc(id)}/attachments`, {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name,
    contentType: optStr(p, 'contentType') ?? 'application/octet-stream',
    contentBytes,
  });
  return { ok: true, summary: `Attached “${name}”`, data: { attachmentId: res.data.id ?? null }, quotaRemaining: quotaFrom(res.headers) };
}

async function downloadAttachment(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'messageId');
  const attachmentId = str(p, 'attachmentId');
  const res = await ctx.http.getJson<GraphAttachment>(`${GRAPH}/me/messages/${enc(id)}/attachments/${enc(attachmentId)}`);
  return {
    ok: true,
    summary: `Downloaded attachment “${res.data.name ?? attachmentId}”`,
    data: { name: res.data.name ?? null, contentBytes: res.data.contentBytes ?? null, contentType: res.data.contentType ?? null, size: res.data.size ?? null },
    quotaRemaining: quotaFrom(res.headers),
  };
}

export const mailActions: WriteAction[] = [
  { id: 'mail.send', label: 'Send email', domain: 'mail', scopes: [SEND], mutates: true, run: send },
  { id: 'mail.saveDraft', label: 'Save draft', domain: 'mail', scopes: [RW], mutates: true, run: saveDraft },
  { id: 'mail.reply', label: 'Reply', domain: 'mail', scopes: [SEND], mutates: true, run: replyLike('reply') },
  { id: 'mail.replyAll', label: 'Reply all', domain: 'mail', scopes: [SEND], mutates: true, run: replyLike('replyAll') },
  { id: 'mail.forward', label: 'Forward', domain: 'mail', scopes: [SEND], mutates: true, run: replyLike('forward') },
  { id: 'mail.move', label: 'Move email', domain: 'mail', scopes: [RW], mutates: true, run: move },
  { id: 'mail.markRead', label: 'Mark read/unread', domain: 'mail', scopes: [RW], mutates: true, run: mark },
  { id: 'mail.delete', label: 'Delete email', domain: 'mail', scopes: [RW], mutates: true, run: remove },
  { id: 'mail.restore', label: 'Restore email', domain: 'mail', scopes: [RW], mutates: true, run: restore },
  { id: 'mail.addAttachment', label: 'Upload attachment', domain: 'mail', scopes: [RW], mutates: true, run: addAttachment },
  { id: 'mail.downloadAttachment', label: 'Download attachment', domain: 'mail', scopes: ['Mail.Read'], mutates: false, run: downloadAttachment },
];
