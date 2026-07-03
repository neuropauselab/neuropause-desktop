import type { ThemeSource } from '@neuropause/shared';
import { useTheme } from '@renderer/providers/ThemeProvider';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Menu, MenuItem, MenuLabel } from '@renderer/components/ui/Menu';

const OPTIONS: { value: ThemeSource; label: string; icon: IconName }[] = [
  { value: 'system', label: 'Auto', icon: 'auto' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

/** Toolbar theme selector — Auto / Light / Dark, reflecting the live source. */
export function ThemeMenu(): JSX.Element {
  const { source, isDark, setSource } = useTheme();
  const triggerIcon: IconName = source === 'system' ? 'auto' : isDark ? 'moon' : 'sun';

  return (
    <Menu
      width={180}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Appearance"
          title="Appearance"
          className={`flex h-8 w-8 items-center justify-center rounded-lg outline-none transition focus-visible:shadow-focus ${
            open ? 'fill-active text-ink' : 'text-muted hover:text-ink fill-hover'
          }`}
        >
          <Icon name={triggerIcon} size={18} />
        </button>
      )}
    >
      <MenuLabel>Appearance</MenuLabel>
      {OPTIONS.map((opt) => (
        <MenuItem
          key={opt.value}
          icon={opt.icon}
          selected={source === opt.value}
          onClick={() => void setSource(opt.value)}
        >
          {opt.label}
        </MenuItem>
      ))}
    </Menu>
  );
}
