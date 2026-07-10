/**
 * P2.4 — Contacts write actions (live Microsoft Graph, no mocks).
 *
 * create / update / delete / search / deterministic duplicate detection. Search + dedup are read helpers
 * (mutates: false); create/update/delete need Contacts.ReadWrite.
 */
import {
  GRAPH,
  enc,
  optStr,
  optStrArr,
  quotaFrom,
  str,
  type WriteAction,
  type WriteActionContext,
  type WriteActionResult,
  type WriteParams,
} from './actionSdk';

const RW = 'Contacts.ReadWrite';
const READ = 'Contacts.Read';

interface GraphContact {
  id?: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  companyName?: string;
  emailAddresses?: Array<{ address?: string; name?: string }>;
}

function contactBody(p: WriteParams, forCreate: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const set = (key: string, val: string | undefined): void => {
    if (val !== undefined) body[key] = val;
  };
  set('givenName', optStr(p, 'givenName'));
  set('surname', optStr(p, 'surname'));
  set('companyName', optStr(p, 'companyName'));
  set('mobilePhone', optStr(p, 'mobilePhone'));
  const emails = optStrArr(p, 'emails');
  if (emails.length > 0 || forCreate) body.emailAddresses = emails.map((address) => ({ address }));
  return body;
}

async function create(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const res = await ctx.http.postJson<GraphContact>(`${GRAPH}/me/contacts`, contactBody(p, true));
  return { ok: true, summary: `Created contact “${res.data.displayName ?? optStr(p, 'givenName') ?? 'contact'}”`, data: { id: res.data.id ?? null }, quotaRemaining: quotaFrom(res.headers) };
}

async function update(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'contactId');
  const res = await ctx.http.patchJson<GraphContact>(`${GRAPH}/me/contacts/${enc(id)}`, contactBody(p, false));
  return { ok: true, summary: 'Updated contact', data: { id: res.data.id ?? id }, quotaRemaining: quotaFrom(res.headers) };
}

async function remove(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const id = str(p, 'contactId');
  const res = await ctx.http.deleteJson(`${GRAPH}/me/contacts/${enc(id)}`);
  return { ok: true, summary: 'Deleted contact', data: { contactId: id }, quotaRemaining: quotaFrom(res.headers) };
}

async function search(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const q = str(p, 'query');
  const res = await ctx.http.getJson<{ value?: GraphContact[] }>(`${GRAPH}/me/contacts`, {
    query: { $search: `"${q}"`, $top: '25' },
  });
  const hits = res.data.value ?? [];
  return { ok: true, summary: `Found ${hits.length} contact(s) matching “${q}”`, data: { count: hits.length }, quotaRemaining: quotaFrom(res.headers) };
}

/** Deterministic duplicate detection: group by normalized primary email, else normalized display name. */
export function detectDuplicates(contacts: GraphContact[]): Array<{ key: string; ids: string[] }> {
  const groups = new Map<string, string[]>();
  for (const c of contacts) {
    if (!c.id) continue;
    const email = c.emailAddresses?.[0]?.address?.trim().toLowerCase();
    const name = (c.displayName ?? `${c.givenName ?? ''} ${c.surname ?? ''}`).trim().toLowerCase();
    const key = email && email.length > 0 ? `email:${email}` : name.length > 0 ? `name:${name}` : null;
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(c.id);
    groups.set(key, list);
  }
  return [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));
}

async function dedup(ctx: WriteActionContext): Promise<WriteActionResult> {
  const res = await ctx.http.getJson<{ value?: GraphContact[] }>(`${GRAPH}/me/contacts`, {
    query: { $select: 'id,displayName,givenName,surname,emailAddresses', $top: '200' },
  });
  const dupes = detectDuplicates(res.data.value ?? []);
  const total = dupes.reduce((n, g) => n + g.ids.length, 0);
  return { ok: true, summary: `Found ${dupes.length} duplicate group(s) across ${total} contacts`, data: { groups: dupes.length, contacts: total }, quotaRemaining: quotaFrom(res.headers) };
}

export const contactActions: WriteAction[] = [
  { id: 'contacts.create', label: 'Create contact', domain: 'contacts', scopes: [RW], mutates: true, run: create },
  { id: 'contacts.update', label: 'Update contact', domain: 'contacts', scopes: [RW], mutates: true, run: update },
  { id: 'contacts.delete', label: 'Delete contact', domain: 'contacts', scopes: [RW], mutates: true, run: remove },
  { id: 'contacts.search', label: 'Search contacts', domain: 'contacts', scopes: [READ], mutates: false, run: search },
  { id: 'contacts.detectDuplicates', label: 'Detect duplicate contacts', domain: 'contacts', scopes: [READ], mutates: false, run: dedup },
];
