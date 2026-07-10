import { describe, expect, it } from 'vitest';
import {
  messageFields,
  eventFields,
  driveItemFields,
  contactFields,
  teamFields,
  splitDriveDelta,
  M365_READ_SCOPES,
  MAIL_DELTA_URL,
  DRIVE_DELTA_URL,
  CONTACTS_DELTA_URL,
  JOINED_TEAMS_URL,
  type GraphDriveItem,
} from '@neuropause/shared';

describe('m365Graph — field extractors (flat primitive metadata)', () => {
  it('flattens a mail message', () => {
    const f = messageFields({
      id: 'm1',
      subject: 'Hello',
      bodyPreview: 'hi there',
      from: { emailAddress: { name: 'Ada', address: 'ada@contoso.com' } },
      receivedDateTime: '2026-07-10T10:00:00Z',
      isRead: false,
      hasAttachments: true,
      conversationId: 'c1',
      webLink: 'https://outlook',
    });
    expect(f.title).toBe('Hello');
    expect(f.author).toBe('ada@contoso.com');
    expect(f.metadata.module).toBe('outlook');
    expect(f.metadata.isRead).toBe(false);
    expect(f.metadata.hasAttachments).toBe(true);
    for (const v of Object.values(f.metadata)) {
      expect(v === null || ['string', 'number', 'boolean'].includes(typeof v)).toBe(true);
    }
  });

  it('defaults an empty subject', () => {
    expect(messageFields({ id: 'm2' }).title).toBe('(no subject)');
  });

  it('flattens a calendar event with recurrence + cancel status', () => {
    const f = eventFields({
      id: 'e1',
      subject: 'Standup',
      start: { dateTime: '2026-07-10T09:00:00' },
      end: { dateTime: '2026-07-10T09:30:00' },
      organizer: { emailAddress: { address: 'boss@contoso.com' } },
      attendees: [{}, {}],
      seriesMasterId: 's1',
      isCancelled: true,
    });
    expect(f.title).toBe('Standup');
    expect(f.start).toBe('2026-07-10T09:00:00');
    expect(f.status).toBe('cancelled');
    expect(f.metadata.isRecurring).toBe(true);
    expect(f.metadata.attendees).toBe(2);
  });

  it('flattens a drive item (file vs folder)', () => {
    const file = driveItemFields({
      id: 'd1',
      name: 'report.docx',
      size: 1234,
      file: { mimeType: 'application/msword' },
      webUrl: 'https://onedrive',
    });
    expect(file.title).toBe('report.docx');
    expect(file.metadata.itemType).toBe('file');
    expect(file.metadata.sizeBytes).toBe(1234);
    const folder = driveItemFields({ id: 'd2', name: 'Docs', folder: { childCount: 5 } });
    expect(folder.metadata.itemType).toBe('folder');
    expect(folder.metadata.childCount).toBe(5);
  });

  it('flattens a contact and a team', () => {
    const c = contactFields({
      id: 'c1',
      displayName: 'Grace Hopper',
      emailAddresses: [{ address: 'grace@contoso.com' }],
      companyName: 'Navy',
    });
    expect(c.title).toBe('Grace Hopper');
    expect(c.author).toBe('grace@contoso.com');
    expect(c.metadata.source).toBe('personal');
    expect(teamFields({ id: 't1', displayName: 'Engineering', visibility: 'private' }).title).toBe('Engineering');
    expect(teamFields({ id: 't2' }).title).toBe('t2');
  });
});

describe('m365Graph — OneDrive delta split (deleted facet)', () => {
  it('separates present items from deleted', () => {
    const resp = {
      value: [
        { id: 'a', name: 'x' },
        { id: 'b', deleted: { state: 'deleted' } },
        { id: 'c', name: 'y' },
      ] as GraphDriveItem[],
    };
    const { present, removedIds } = splitDriveDelta(resp);
    expect(present.map((p) => p.id)).toEqual(['a', 'c']);
    expect(removedIds).toEqual(['b']);
  });
});

describe('m365Graph — least-privilege scopes + real endpoints', () => {
  it('requests READ scopes only (no write/send this increment)', () => {
    expect(M365_READ_SCOPES).toEqual(['Mail.Read', 'Calendars.Read', 'Files.Read', 'Contacts.Read', 'Team.ReadBasic.All']);
    expect(M365_READ_SCOPES.some((s) => s.includes('ReadWrite') || s.includes('Send'))).toBe(false);
  });

  it('targets real Graph v1.0 endpoints', () => {
    expect(MAIL_DELTA_URL).toContain('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta');
    expect(DRIVE_DELTA_URL).toBe('https://graph.microsoft.com/v1.0/me/drive/root/delta');
    expect(CONTACTS_DELTA_URL).toContain('/me/contacts/delta');
    expect(JOINED_TEAMS_URL).toBe('https://graph.microsoft.com/v1.0/me/joinedTeams');
  });
});
