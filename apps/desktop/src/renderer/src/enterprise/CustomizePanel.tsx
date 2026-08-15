import { useState } from 'react';
import type { EnterprisePermission, OrgUnitKind } from '@neuropause/shared';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel } from '@renderer/operations/primitives';
import { cn } from '@renderer/lib/cn';
import { useEnterprise } from './EnterpriseProvider';
import {
  unitKindLabel,
  titleCase,
  TINT_TONE,
  loadNavPrefs,
  saveNavPrefs,
  resetWidgetPrefs,
} from './lib';

const NAV: { id: string; label: string }[] = [
  { id: 'command', label: 'Command Center' },
  { id: 'decision', label: 'Decision Center' },
  { id: 'organization', label: 'Org Structure' },
  { id: 'operations', label: 'Operations' },
  { id: 'search', label: 'Search' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'briefings', label: 'Briefings' },
  { id: 'customize', label: 'Customize' },
];

const ROLE_PERMS: { id: EnterprisePermission; label: string }[] = [
  { id: 'org:read', label: 'View organization' },
  { id: 'people:read', label: 'View people' },
  { id: 'workforce:read', label: 'View workforce' },
  { id: 'workforce:operate', label: 'Operate workers' },
  { id: 'workforce:approve', label: 'Approve actions' },
  { id: 'governance:read', label: 'View governance' },
  { id: 'dashboard:read', label: 'View dashboards' },
  { id: 'operations:read', label: 'View operations' },
];

const UNIT_KINDS: OrgUnitKind[] = ['business_unit', 'department', 'team'];

export function CustomizePanel(): JSX.Element {
  const { org, governance, createUnit, deleteUnit, createRole, setChain, setRule, createUser, updateUser, deleteUser } =
    useEnterprise();

  const [nav, setNav] = useState<Set<string>>(() => loadNavPrefs(NAV.map((n) => n.id)));
  const [unitName, setUnitName] = useState('');
  const [unitKind, setUnitKind] = useState<OrgUnitKind>('team');
  const [unitParent, setUnitParent] = useState<string>('');
  // People management (round 36 — Gate 5: the audited backend CRUD finally
  // has a caller). `peopleError` surfaces refusals verbatim — a denied
  // mutation here must never be a silent no-op.
  const [personName, setPersonName] = useState('');
  const [personEmail, setPersonEmail] = useState('');
  const [personTitle, setPersonTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [roleName, setRoleName] = useState('');
  const [rolePerms, setRolePerms] = useState<Set<EnterprisePermission>>(new Set(['org:read', 'dashboard:read']));
  const [busy, setBusy] = useState(false);

  const toggleNav = (id: string): void => {
    setNav((prev) => {
      const next = new Set(prev);
      if (id === 'command') return next; // locked
      if (next.has(id)) next.delete(id); else next.add(id);
      // Round 36: persistence is scoped to the tabs THIS panel manages, so
      // the 8 unmanaged Enterprise tabs can never be hidden by a save here.
      saveNavPrefs(next, NAV.map((n) => n.id));
      window.dispatchEvent(new Event('np:nav'));
      return next;
    });
  };

  const addUnit = async (): Promise<void> => {
    if (!unitName.trim()) return;
    setBusy(true);
    try {
      await createUnit({ kind: unitKind, name: unitName.trim(), parentId: unitParent || null });
      setUnitName('');
      setUnitParent('');
    } finally {
      setBusy(false);
    }
  };

  const describePeopleError = (err: unknown): string =>
    err instanceof Error && err.message ? err.message : 'That did not work.';

  const addPerson = async (): Promise<void> => {
    if (!personName.trim()) return;
    setBusy(true);
    setPeopleError(null);
    try {
      await createUser({
        name: personName.trim(),
        email: personEmail.trim() ? personEmail.trim() : null,
        title: personTitle.trim() || undefined,
      });
      setPersonName('');
      setPersonEmail('');
      setPersonTitle('');
    } catch (err) {
      setPeopleError(describePeopleError(err));
    } finally {
      setBusy(false);
    }
  };

  const removePerson = async (id: string): Promise<void> => {
    setBusy(true);
    setPeopleError(null);
    try {
      await deleteUser(id);
    } catch (err) {
      setPeopleError(describePeopleError(err));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (u: { id: string; name: string; email: string | null; title: string }): void => {
    setEditingId(u.id);
    setEditName(u.name);
    setEditEmail(u.email ?? '');
    setEditTitle(u.title);
    setPeopleError(null);
  };

  const saveEdit = async (): Promise<void> => {
    if (editingId === null || !editName.trim()) return;
    setBusy(true);
    setPeopleError(null);
    try {
      // The owner row's email is immutable by design (round 32 / O-13): the
      // handler strips it, so it is not offered here either.
      // Round 40: keyed on the tenant's RECORDED owner, so provisioned orgs
      // show the same protections as the seeded one (fallback: seeded literal).
      const isOwner = editingId === (org.organization?.ownerUserId ?? 'user-owner');
      await updateUser({
        id: editingId,
        name: editName.trim(),
        title: editTitle.trim() || undefined,
        ...(isOwner ? {} : { email: editEmail.trim() ? editEmail.trim() : null }),
      });
      setEditingId(null);
    } catch (err) {
      setPeopleError(describePeopleError(err));
    } finally {
      setBusy(false);
    }
  };

  const addRole = async (): Promise<void> => {
    if (!roleName.trim()) return;
    setBusy(true);
    try {
      await createRole({ name: roleName.trim(), permissions: [...rolePerms] });
      setRoleName('');
      setRolePerms(new Set(['org:read', 'dashboard:read']));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-5 text-sm text-muted">Configure how the organization’s NeuroPause works — dashboards, navigation, structure, roles, governance, and theme.</p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Dashboards & KPI widgets */}
        <OpsPanel title="Dashboards & KPI widgets" subtitle="Configurable per surface">
          <p className="text-sm text-muted">The Command Center and Business Operations dashboards each have an inline <span className="font-medium text-ink">Customize</span> control to show or hide their widgets and KPIs. Your selections are remembered on this device.</p>
          <button type="button" onClick={resetWidgetPrefs} className={cn('mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold', TINT_TONE.gray)}>
            <Icon name="undo" size={13} /> Reset dashboard widgets
          </button>
        </OpsPanel>

        {/* Navigation */}
        <OpsPanel title="Navigation" subtitle="Which surfaces appear in the Enterprise tabs">
          <div className="flex flex-wrap gap-2">
            {NAV.map((n) => {
              const on = nav.has(n.id);
              const locked = n.id === 'command';
              return (
                <button key={n.id} type="button" onClick={() => toggleNav(n.id)} disabled={locked} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition', on ? 'border-transparent bg-accent/15 text-accent' : 'border-[var(--hairline)] text-faint', locked && 'opacity-60')}>
                  <Icon name={on ? 'check' : 'plus'} size={12} /> {n.label}{locked && ' (home)'}
                </button>
              );
            })}
          </div>
        </OpsPanel>

        {/* Branding */}
        <OpsPanel title="Branding" subtitle="Organization identity">
          <div className="flex items-center gap-3 rounded-xl border border-[var(--hairline)] p-3">
            <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', TINT_TONE.accent)}><Icon name="grid" size={20} /></span>
            <div>
              <div className="text-sm font-semibold text-ink">{org.organization?.name ?? 'NeuroPause'}</div>
              <div className="text-2xs text-faint">{org.organization?.slug ?? 'organization'} · {org.users.length} member(s)</div>
            </div>
          </div>
          <p className="mt-2 text-2xs text-faint">The organization name and identity brand every surface. Full white-label branding (logo upload, custom palette) lands with the Ecosystem phase.</p>
        </OpsPanel>
      </div>

      {/* Business units */}
      <OpsPanel title="Business units" subtitle="Departments and teams" className="mt-1">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <input value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="New unit name…" className="min-w-44 flex-1 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-1.5 text-sm text-ink outline-none focus-visible:shadow-focus placeholder:text-faint" />
          <select value={unitKind} onChange={(e) => setUnitKind(e.target.value as OrgUnitKind)} className="rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2.5 py-1.5 text-sm text-ink outline-none focus-visible:shadow-focus">
            {UNIT_KINDS.map((k) => <option key={k} value={k}>{unitKindLabel(k)}</option>)}
          </select>
          <select value={unitParent} onChange={(e) => setUnitParent(e.target.value)} className="rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2.5 py-1.5 text-sm text-ink outline-none focus-visible:shadow-focus">
            <option value="">No parent</option>
            {org.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button type="button" disabled={busy || !unitName.trim()} onClick={() => void addUnit()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-40"><Icon name="plus" size={13} /> Add</button>
        </div>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {org.units.map((u) => {
            const lead = u.leadUserId ? org.users.find((x) => x.id === u.leadUserId) : null;
            return (
              <li key={u.id} className="flex items-center gap-2 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5">
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', TINT_TONE.blue)}><Icon name="layers" size={12} /></span>
                <div className="min-w-0 flex-1"><div className="truncate text-sm text-ink">{u.name}</div><div className="text-2xs text-faint">{unitKindLabel(u.kind)}{lead ? ` · ${lead.name}` : ''}</div></div>
                <button type="button" onClick={() => void deleteUnit(u.id)} className="text-faint fill-hover hover:text-syspink" title="Delete unit"><Icon name="trash" size={13} /></button>
              </li>
            );
          })}
        </ul>
      </OpsPanel>

      {/* People (round 36 — Gate 5: the audited backend CRUD, finally reachable) */}
      <OpsPanel title="People" subtitle="Who belongs to this organization" className="mt-1">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Full name…" className="min-w-36 flex-1 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-1.5 text-sm text-ink outline-none focus-visible:shadow-focus placeholder:text-faint" />
          <input value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} placeholder="Email (sign-in address)…" type="email" autoComplete="off" className="min-w-44 flex-1 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-1.5 text-sm text-ink outline-none focus-visible:shadow-focus placeholder:text-faint" />
          <input value={personTitle} onChange={(e) => setPersonTitle(e.target.value)} placeholder="Title…" className="min-w-28 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-1.5 text-sm text-ink outline-none focus-visible:shadow-focus placeholder:text-faint" />
          <button type="button" disabled={busy || !personName.trim()} onClick={() => void addPerson()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-40"><Icon name="plus" size={13} /> Add person</button>
        </div>
        {peopleError && (
          <p role="alert" className="mb-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-2xs leading-relaxed text-danger">{peopleError}</p>
        )}
        <ul className="space-y-1.5">
          {org.users.filter((u) => u.kind === 'human').map((u) => {
            const isOwner = u.id === (org.organization?.ownerUserId ?? 'user-owner');
            if (editingId === u.id) {
              return (
                <li key={u.id} className="flex flex-wrap items-end gap-2 rounded-xl border border-accent/40 p-2.5">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" className="min-w-32 flex-1 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-1.5 text-sm text-ink outline-none focus-visible:shadow-focus" />
                  {!isOwner && (
                    <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" type="email" autoComplete="off" className="min-w-40 flex-1 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-1.5 text-sm text-ink outline-none focus-visible:shadow-focus" />
                  )}
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" className="min-w-24 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-3 py-1.5 text-sm text-ink outline-none focus-visible:shadow-focus" />
                  <button type="button" disabled={busy || !editName.trim()} onClick={() => void saveEdit()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-40">Save</button>
                  <button type="button" disabled={busy} onClick={() => setEditingId(null)} className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-xs text-muted">Cancel</button>
                </li>
              );
            }
            return (
              <li key={u.id} className="flex items-center gap-2 rounded-xl border border-[var(--hairline)] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{u.name}{isOwner && <span className="ml-1.5 text-2xs text-faint">· Owner (protected)</span>}</div>
                  <div className="truncate text-2xs text-faint">{u.email ?? 'no sign-in address'}{u.title ? ` · ${u.title}` : ''}</div>
                </div>
                <button type="button" disabled={busy} onClick={() => startEdit(u)} className="rounded-lg border border-[var(--hairline)] px-2 py-1 text-2xs text-muted fill-hover hover:text-ink" title="Edit person">Edit</button>
                {!isOwner && (
                  <button type="button" disabled={busy} onClick={() => void removePerson(u.id)} className="text-faint fill-hover hover:text-syspink" title="Remove person"><Icon name="trash" size={13} /></button>
                )}
              </li>
            );
          })}
        </ul>
      </OpsPanel>

      {/* Roles */}
      <OpsPanel title="Roles" subtitle="Permission sets">
        <div className="mb-3 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="New role name…" className="min-w-44 flex-1 rounded-lg border border-[var(--hairline)] surface-raised px-3 py-1.5 text-sm text-ink outline-none focus-visible:shadow-focus placeholder:text-faint" />
            <button type="button" disabled={busy || !roleName.trim()} onClick={() => void addRole()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-40"><Icon name="plus" size={13} /> Create role</button>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {ROLE_PERMS.map((p) => {
              const on = rolePerms.has(p.id);
              return (
                <button key={p.id} type="button" onClick={() => setRolePerms((prev) => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-2xs font-medium transition', on ? 'border-transparent bg-accent/15 text-accent' : 'border-[var(--hairline)] text-faint')}>
                  <Icon name={on ? 'check' : 'plus'} size={10} /> {p.label}
                </button>
              );
            })}
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {org.roles.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5">
              <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', TINT_TONE.purple)}><Icon name="user" size={12} /></span>
              <div className="min-w-0 flex-1"><div className="truncate text-sm text-ink">{r.name}{r.builtIn && <span className="ml-1.5 text-2xs text-faint">built-in</span>}</div><div className="truncate text-2xs text-faint">{r.permissions.length} permission(s)</div></div>
            </li>
          ))}
        </ul>
      </OpsPanel>

      {/* Governance: approval chains + compliance rules */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <OpsPanel title="Approval chains" subtitle="Who must sign off">
          {!governance || governance.approvalChains.length === 0 ? (
            <Empty text="No approval chains configured." />
          ) : (
            <ul className="space-y-1.5">
              {governance.approvalChains.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-lg border border-[var(--hairline)] px-2.5 py-2">
                  <div className="min-w-0 flex-1"><div className="truncate text-sm text-ink">{c.name}</div><div className="truncate text-2xs text-faint">{c.steps.length} step(s) · {c.description}</div></div>
                  <Toggle on={c.enabled} onClick={() => void setChain(c.id, !c.enabled)} />
                </li>
              ))}
            </ul>
          )}
        </OpsPanel>

        <OpsPanel title="Compliance rules" subtitle="Policy checks">
          {!governance || governance.complianceRules.length === 0 ? (
            <Empty text="No compliance rules configured." />
          ) : (
            <ul className="space-y-1.5">
              {governance.complianceRules.map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-lg border border-[var(--hairline)] px-2.5 py-2">
                  <div className="min-w-0 flex-1"><div className="truncate text-sm text-ink">{r.name}</div><div className="truncate text-2xs text-faint">{titleCase(r.category)} · {r.severity}</div></div>
                  <Toggle on={r.enabled} onClick={() => void setRule(r.id, !r.enabled)} />
                </li>
              ))}
            </ul>
          )}
        </OpsPanel>
      </div>
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className={cn('relative h-5 w-9 shrink-0 rounded-full transition', on ? 'bg-accent' : 'bg-[var(--fill-3)]')} aria-pressed={on}>
      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-[background-color,color,border-color,box-shadow,transform,opacity] motion-reduce:transition-none', on ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

function Empty({ text }: { text: string }): JSX.Element {
  return <div className="rounded-xl border border-dashed border-[var(--hairline)] p-5 text-center text-sm text-faint">{text}</div>;
}
