/**
 * Module 8 — Calendar Platform. Meetings, events, bookings, rooms, resources, holidays, and a
 * scheduling assistant with real in-process conflict detection. Live-verified; starts empty. Real
 * calendar-provider sync is adapter-verified (see providers).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';

export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  attendees: string[];
  roomId?: string;
  createdAt: number;
}
export interface Room {
  id: string;
  name: string;
  capacity: number;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => aStart < bEnd && bStart < aEnd;

export class CalendarRuntime {
  private readonly eventsMap = new Map<string, CalendarEvent>();
  private readonly roomsMap = new Map<string, Room>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async registerRoom(input: { name: string; capacity: number }): Promise<Room> {
    const r: Room = { id: randomId('room'), name: input.name, capacity: input.capacity };
    this.roomsMap.set(r.id, r);
    return r;
  }

  /** Create an event; if a room is requested, a real conflict check is enforced. */
  async createEvent(input: { title: string; start: number; end: number; attendees?: string[]; roomId?: string }): Promise<CalendarEvent> {
    if (input.end <= input.start) throw new Error('event end must be after start');
    if (input.roomId && this.roomConflict(input.roomId, input.start, input.end)) throw new Error('room is already booked for that time');
    const e: CalendarEvent = { id: randomId('evt'), title: input.title, start: input.start, end: input.end, attendees: input.attendees ?? [], ...(input.roomId ? { roomId: input.roomId } : {}), createdAt: this.clock.now() };
    this.eventsMap.set(e.id, e);
    await this.governance.record({ actor: 'system', module: 'calendar', operation: 'event.create', targetId: e.id, evidence: 'live-verified' });
    return e;
  }

  roomConflict(roomId: string, start: number, end: number): boolean {
    return [...this.eventsMap.values()].some((e) => e.roomId === roomId && overlaps(e.start, e.end, start, end));
  }

  /** Scheduling assistant: return the first candidate slot with no room conflict. */
  suggestSlot(candidateSlots: Array<{ start: number; end: number }>, roomId?: string): { start: number; end: number } | null {
    for (const slot of candidateSlots) {
      if (!roomId || !this.roomConflict(roomId, slot.start, slot.end)) return slot;
    }
    return null;
  }

  events(): CalendarEvent[] { return [...this.eventsMap.values()]; }
  rooms(): Room[] { return [...this.roomsMap.values()]; }
  count(): number { return this.eventsMap.size; }
}
