/**
 * P2.4 — Calendar write actions (live Microsoft Graph, no mocks).
 *
 * create / update / delete / invite attendees / respond (accept·decline·tentative) / recurring /
 * online Teams meeting. Recurring + online-meeting are options on create/update, not separate endpoints.
 */
import {
  GRAPH,
  enc,
  optObj,
  optStr,
  optStrArr,
  quotaFrom,
  str,
  type WriteAction,
  type WriteActionContext,
  type WriteActionResult,
  type WriteParams,
} from './actionSdk';

const RW = 'Calendars.ReadWrite';

interface GraphEventRef {
  id?: string;
  webLink?: string;
  onlineMeeting?: { joinUrl?: string } | null;
}

function attendees(addresses: string[]): Array<{ emailAddress: { address: string }; type: string }> {
  return addresses.map((address) => ({ emailAddress: { address }, type: 'required' }));
}

/** Compose the Graph event body from params. Shared by create + update (update sends only provided fields). */
function eventBody(p: WriteParams, forCreate: boolean): Record<string, unknown> {
  const tz = optStr(p, 'timeZone') ?? 'UTC';
  const body: Record<string, unknown> = {};
  const subject = optStr(p, 'subject');
  if (subject !== undefined || forCreate) body.subject = subject ?? '(no subject)';
  const startDt = optStr(p, 'start');
  if (startDt) body.start = { dateTime: startDt, timeZone: tz };
  const endDt = optStr(p, 'end');
  if (endDt) body.end = { dateTime: endDt, timeZone: tz };
  const content = optStr(p, 'body');
  if (content !== undefined) body.body = { contentType: optStr(p, 'bodyType') === 'html' ? 'html' : 'text', content };
  const location = optStr(p, 'location');
  if (location !== undefined) body.location = { displayName: location };
  const invitees = optStrArr(p, 'attendees');
  if (invitees.length > 0) body.attendees = attendees(invitees);
  const recurrence = optObj(p, 'recurrence');
  if (recurrence) body.recurrence = recurrence;
  if (optObj(p, 'onlineMeeting') || p['isOnlineMeeting'] === true) {
    body.isOnlineMeeting = true;
    body.onlineMeetingProvider = optStr(p, 'onlineMeetingProvider') ?? 'teamsForBusiness';
  }
  return body;
}

async function create(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const res = await ctx.http.postJson<GraphEventRef>(`${GRAPH}/me/events`, eventBody(p, true));
  const joinUrl = res.data.onlineMeeting?.joinUrl ?? null;
  return {
    ok: true,
    summary: `Created event “${optStr(p, 'subject') ?? '(no subject)'}”${joinUrl ? ' with a Teams meeting' : ''}`,
    data: { id: res.data.id ?? null, webLink: res.data.webLink ?? null, joinUrl },
    quotaRemaining: quotaFrom(res.headers),
  };
}

async function update(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'eventId');
  const res = await ctx.http.patchJson<GraphEventRef>(`${GRAPH}/me/events/${enc(id)}`, eventBody(p, false));
  return { ok: true, summary: 'Updated event', data: { id: res.data.id ?? id }, quotaRemaining: quotaFrom(res.headers) };
}

async function remove(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'eventId');
  const res = await ctx.http.deleteJson(`${GRAPH}/me/events/${enc(id)}`);
  return { ok: true, summary: 'Deleted event', data: { eventId: id }, quotaRemaining: quotaFrom(res.headers) };
}

async function invite(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'eventId');
  const invitees = optStrArr(p, 'attendees');
  const res = await ctx.http.patchJson<GraphEventRef>(`${GRAPH}/me/events/${enc(id)}`, { attendees: attendees(invitees) });
  return { ok: true, summary: `Invited ${invitees.length} attendee(s)`, data: { id: res.data.id ?? id }, quotaRemaining: quotaFrom(res.headers) };
}

const RESPONSE_PATH: Record<string, string> = { accept: 'accept', decline: 'decline', tentative: 'tentativelyAccept' };

async function respond(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'eventId');
  const mode = str(p, 'response');
  const path = RESPONSE_PATH[mode];
  if (!path) throw new Error(`Unknown response "${mode}" (expected accept|decline|tentative)`);
  const res = await ctx.http.postJson(`${GRAPH}/me/events/${enc(id)}/${path}`, {
    comment: optStr(p, 'comment') ?? '',
    sendResponse: true,
  });
  return { ok: true, summary: `Responded “${mode}” to event`, data: { eventId: id, response: mode }, quotaRemaining: quotaFrom(res.headers) };
}

export const calendarActions: WriteAction[] = [
  { id: 'calendar.create', label: 'Create meeting', domain: 'calendar', scopes: [RW], mutates: true, run: create },
  { id: 'calendar.update', label: 'Update meeting', domain: 'calendar', scopes: [RW], mutates: true, run: update },
  { id: 'calendar.delete', label: 'Delete meeting', domain: 'calendar', scopes: [RW], mutates: true, run: remove },
  { id: 'calendar.invite', label: 'Invite attendees', domain: 'calendar', scopes: [RW], mutates: true, run: invite },
  { id: 'calendar.respond', label: 'Respond to invite', domain: 'calendar', scopes: [RW], mutates: true, run: respond },
];
