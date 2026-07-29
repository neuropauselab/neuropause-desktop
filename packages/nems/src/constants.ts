/** @neuropause/nems version (NEMS Wave 1). */
export const NEMS_VERSION = '0.0.0-preview.1';

/** Built-in roles (mapped onto the one security authorization model). */
export const BUILTIN_ROLES = ['admin', 'executive', 'manager', 'contributor', 'viewer'] as const;
export type BuiltinRole = (typeof BUILTIN_ROLES)[number];
