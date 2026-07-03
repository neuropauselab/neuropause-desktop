/**
 * The native application menu. Menu items carry real keyboard accelerators and
 * dispatch MenuCommand messages to the renderer, so the menu bar, the keyboard,
 * and the in-app controls all drive the same shell behaviour. Standard roles
 * (Edit, Window, full-screen) use Electron's built-ins for correct native
 * behaviour and localization.
 */
import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommandPayload } from '@neuropause/shared';
import { config } from './config';

const isMac = process.platform === 'darwin';

/** Section order must match the renderer's sidebar (sections.ts). */
const SECTIONS = [
  'Home',
  'AI Store',
  'Workspace',
  'Connectors',
  'AI Memory',
  'Automations',
  'Notifications',
  'Analytics',
  'Settings',
];

export function buildAppMenu(send: (payload: MenuCommandPayload) => void): Menu {
  const appMenu: MenuItemConstructorOptions = {
    label: app.getName(),
    submenu: [
      { role: 'about', label: `About ${app.getName()}` },
      { type: 'separator' },
      {
        label: 'Settings…',
        accelerator: 'CmdOrCtrl+,',
        click: () => send({ action: 'open-settings' }),
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'New Workspace Tab',
        accelerator: 'CmdOrCtrl+T',
        click: () => send({ action: 'new-tab' }),
      },
      {
        label: 'Close Tab',
        accelerator: 'CmdOrCtrl+W',
        click: () => send({ action: 'close-tab' }),
      },
      { type: 'separator' },
      { role: 'close', label: 'Close Window', accelerator: 'Shift+CmdOrCtrl+W' },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      {
        label: 'Command Palette…',
        accelerator: 'CmdOrCtrl+K',
        click: () => send({ action: 'command-palette' }),
      },
      { type: 'separator' },
      {
        label: 'Actual Size',
        accelerator: 'CmdOrCtrl+0',
        click: () => send({ action: 'zoom-reset' }),
      },
      {
        label: 'Zoom In',
        accelerator: 'CmdOrCtrl+Plus',
        click: () => send({ action: 'zoom-in' }),
      },
      {
        label: 'Zoom Out',
        accelerator: 'CmdOrCtrl+-',
        click: () => send({ action: 'zoom-out' }),
      },
      { type: 'separator' },
      ...(config.isDev
        ? ([
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
          ] as MenuItemConstructorOptions[])
        : []),
      { role: 'togglefullscreen' },
    ],
  };

  const goMenu: MenuItemConstructorOptions = {
    label: 'Go',
    submenu: SECTIONS.map((label, i) => ({
      label,
      accelerator: `CmdOrCtrl+${i + 1}`,
      click: () => send({ action: 'navigate', index: i + 1 }),
    })),
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? ([{ type: 'separator' }, { role: 'front' }] as MenuItemConstructorOptions[])
        : []),
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      {
        label: 'NeuroPause Help',
        click: () => void shell.openExternal('https://neuropause.app'),
      },
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    goMenu,
    windowMenu,
    helpMenu,
  ];

  return Menu.buildFromTemplate(template);
}
