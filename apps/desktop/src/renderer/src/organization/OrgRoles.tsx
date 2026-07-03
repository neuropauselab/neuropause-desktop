import type { CloudOrgRole } from '@neuropause/shared';
import { Card, CardHeader } from '@renderer/components/ui/Card';
import { Icon } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';
import { ROLE_LABEL, useCloudOrg } from './CloudOrgProvider';

const ROLES: CloudOrgRole[] = ['owner', 'admin', 'member', 'viewer'];

/** Capabilities mirror the backend authorization rules exactly. */
const CAPABILITIES: { label: string; allowed: CloudOrgRole[] }[] = [
  {
    label: 'View organization, members & workspaces',
    allowed: ['owner', 'admin', 'member', 'viewer'],
  },
  { label: 'Invite members & manage invitations', allowed: ['owner', 'admin'] },
  { label: 'Change member roles', allowed: ['owner', 'admin'] },
  { label: 'Remove members', allowed: ['owner', 'admin'] },
  { label: 'Rename the organization', allowed: ['owner', 'admin'] },
  { label: 'Create & manage workspaces', allowed: ['owner', 'admin'] },
  { label: 'Grant or change the owner role', allowed: ['owner'] },
];

/** Read-only reference of what each role can do in this organization. */
export function OrgRoles(): JSX.Element {
  const { activeOrg } = useCloudOrg();
  if (!activeOrg) return <></>;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon={<Icon name="shield" size={16} />}
          title="Roles & permissions"
          tint="teal"
        />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10 text-muted">
                <th className="py-2 pr-3 text-left font-medium">Capability</th>
                {ROLES.map((r) => (
                  <th
                    key={r}
                    className={cn(
                      'px-3 py-2 text-center font-medium',
                      r === activeOrg.role ? 'text-accent' : '',
                    )}
                  >
                    {ROLE_LABEL[r]}
                    {r === activeOrg.role && <div className="text-2xs text-faint">You</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap) => (
                <tr key={cap.label} className="border-b border-white/5 last:border-0">
                  <td className="py-2.5 pr-3 text-ink">{cap.label}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-3 py-2.5 text-center">
                      {cap.allowed.includes(r) ? (
                        <Icon name="check" size={15} className="inline text-sysgreen" />
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="flex gap-2.5">
          <Icon name="info" size={16} className="mt-0.5 shrink-0 text-accent" />
          <p className="text-sm text-muted">
            The last owner can’t be demoted or removed — every organization always keeps at least
            one owner. Only owners can grant or change the owner role; admins manage everyone below
            them.
          </p>
        </div>
      </Card>
    </div>
  );
}
