import { Menu, MenuItem, MenuLabel } from '@renderer/components/ui/Menu';
import { Icon } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';
import { ROLE_LABEL, useCloudOrg } from './CloudOrgProvider';

/**
 * The organization switcher: shows the active organization and lets the user
 * switch between the organizations they belong to, or start creating a new one.
 */
export function OrgSwitcher({ onCreate }: { onCreate: () => void }): JSX.Element {
  const { orgs, activeOrg, setActiveOrg } = useCloudOrg();

  return (
    <Menu
      align="end"
      width={264}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="app-no-drag flex h-9 items-center gap-2 rounded-xl px-3 text-base font-medium surface-raised shadow-card outline-none transition fill-hover focus-visible:shadow-focus"
        >
          <Icon name="user" size={16} className="text-accent" />
          <span className="max-w-[168px] truncate">
            {activeOrg ? activeOrg.name : 'No organization'}
          </span>
          <Icon
            name="chevron-down"
            size={14}
            className={cn('text-muted transition-transform', open ? 'rotate-180' : '')}
          />
        </button>
      )}
    >
      {orgs.length > 0 && <MenuLabel>Your organizations</MenuLabel>}
      {orgs.map((o) => (
        <MenuItem
          key={o.orgId}
          icon="user"
          selected={o.orgId === activeOrg?.orgId}
          onClick={() => setActiveOrg(o.orgId)}
          trailing={<span className="text-2xs text-faint">{ROLE_LABEL[o.role]}</span>}
        >
          {o.name}
        </MenuItem>
      ))}
      {orgs.length === 0 && (
        <div className="px-2.5 py-2 text-sm text-muted">You’re not in any organization yet.</div>
      )}
      <div className="my-1 h-px bg-white/10" />
      <MenuItem icon="plus" onClick={onCreate}>
        New organization…
      </MenuItem>
    </Menu>
  );
}
