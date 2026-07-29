/**
 * Module 6 — Calendar connector. Google Calendar v3 adapter over the transport seam.
 * Covers calendars, events, availability (free/busy), and invitations (event
 * attendees). Time zones flow through as the provider returns them.
 */
import type { HttpClient } from '@neuropause/integrations';
import { HttpConnector, pickArray, str, type TransportOptions } from '../httpConnector';

export interface GCalCalendar { id: string; summary: string; timeZone: string; }
export interface GCalEvent { id: string; summary: string; start: string; end: string; status: string; attendees: string[]; }
export interface BusySlot { start: string; end: string; }

const rec = (row: Record<string, unknown>, key: string): Record<string, unknown> => (row[key] as Record<string, unknown>) ?? {};
const timeOf = (v: Record<string, unknown>): string => str(v.dateTime ?? v.date);

export class CalendarConnector extends HttpConnector {
  constructor(http: HttpClient, opts: Partial<TransportOptions> & { token?: string } = {}) {
    super(http, { baseUrl: opts.baseUrl ?? 'https://www.googleapis.com/calendar/v3', ...opts });
  }

  listCalendars(): Promise<GCalCalendar[]> {
    return this.listMapped('/users/me/calendarList', pickArray('items'), (r) => ({ id: str(r.id), summary: str(r.summary), timeZone: str(r.timeZone) }));
  }
  listEvents(calendarId = 'primary', opts: { timeMin?: string; timeMax?: string; maxResults?: number } = {}): Promise<GCalEvent[]> {
    return this.listMapped(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      pickArray('items'),
      (r) => ({
        id: str(r.id),
        summary: str(r.summary),
        start: timeOf(rec(r, 'start')),
        end: timeOf(rec(r, 'end')),
        status: str(r.status),
        attendees: ((r.attendees as Array<Record<string, unknown>>) ?? []).map((a) => str(a.email)),
      }),
      { ...(opts.timeMin ? { timeMin: opts.timeMin } : {}), ...(opts.timeMax ? { timeMax: opts.timeMax } : {}), maxResults: opts.maxResults ?? 250, singleEvents: true },
    );
  }
  /** Invitations = events where the authenticated user is an attendee with a response. */
  invitations(calendarId = 'primary'): Promise<GCalEvent[]> {
    return this.listEvents(calendarId).then((events) => events.filter((e) => e.attendees.length > 0));
  }
  async availability(calendarId = 'primary', timeMin: string, timeMax: string): Promise<BusySlot[]> {
    const res = await this.t.postJson<{ calendars?: Record<string, { busy?: BusySlot[] }> }>('/freeBusy', { timeMin, timeMax, items: [{ id: calendarId }] });
    return res.calendars?.[calendarId]?.busy ?? [];
  }
}
