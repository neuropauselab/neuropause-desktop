/**
 * The manifest that travels with a governed export.
 *
 * An exported spreadsheet on its own answers "what" and nothing else. Six
 * months later nobody can say who produced it, from which system, under which
 * filters, or whether the copy in front of them is the one that was written.
 * The manifest answers those questions — and carries NOT ONE business value,
 * so it can be logged, forwarded and kept without re-exposing the data it
 * describes.
 *
 * Packaging reuses the Data Plane's existing ZIP writer, the same code that
 * makes an `.xlsx` a real OOXML package. There is no second archive format
 * here and no new dependency.
 */
import { createHash } from 'node:crypto';
import type {
  DataPlaneExportFormat,
  DataPlaneExportManifest,
  DataPlaneExportScopeKind,
} from '@neuropause/shared';
import { buildZip } from './zipWriter';

/**
 * Bumped when the SHAPE changes, so a reader can tell a v1 manifest from a v2
 * rather than inferring it from which keys happen to be present.
 */
export const EXPORT_MANIFEST_SCHEMA_VERSION = 1;

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export interface ManifestInput {
  exportId: string;
  createdAt: string;
  createdBy: string;
  appName: string;
  appVersion: string;
  workspaceId: string | null;
  tenantId: string | null;
  moduleId: string;
  title: string;
  entityPlural: string;
  scope: {
    kind: DataPlaneExportScopeKind;
    label: string;
    recordCount: number;
    moduleRecordCount: number;
    filters: { field: string; value: string }[];
    recordIds: string[] | null;
  };
  fields: { key: string; label: string }[];
  excludedFields: { key: string; label: string; reason: string }[];
  includesRestricted: boolean;
  format: DataPlaneExportFormat;
  dataFile: string;
  dataFileSha256: string;
  provenance: { included: boolean; tracedRecords: number; untracedRecords: number };
}

export function buildManifest(input: ManifestInput): DataPlaneExportManifest {
  return {
    exportId: input.exportId,
    schemaVersion: EXPORT_MANIFEST_SCHEMA_VERSION,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    application: { name: input.appName, version: input.appVersion },
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
    source: { moduleId: input.moduleId, title: input.title, entityPlural: input.entityPlural },
    scope: input.scope,
    fields: input.fields,
    excludedFields: input.excludedFields,
    includesRestricted: input.includesRestricted,
    format: input.format,
    dataFile: input.dataFile,
    dataFileSha256: input.dataFileSha256,
    provenance: input.provenance,
  };
}

/**
 * A human-readable companion to the manifest.
 *
 * The JSON is for machines and the JSON is the record of truth; this exists
 * because the person who opens the zip in six months is a person. It restates
 * the same facts and invents none.
 */
export function readmeFor(manifest: DataPlaneExportManifest): string {
  const lines = [
    `NeuroPause export ${manifest.exportId}`,
    '',
    `Created:        ${manifest.createdAt}`,
    `Created by:     ${manifest.createdBy}`,
    `Application:    ${manifest.application.name} ${manifest.application.version}`,
    `Source module:  ${manifest.source.title} (${manifest.source.moduleId})`,
    `Scope:          ${manifest.scope.label}`,
    `Records:        ${manifest.scope.recordCount} of ${manifest.scope.moduleRecordCount} in the module`,
    `Fields:         ${manifest.fields.map((f) => f.label).join(', ') || '(none)'}`,
    `Format:         ${manifest.format.toUpperCase()}`,
    `Data file:      ${manifest.dataFile}`,
    `SHA-256:        ${manifest.dataFileSha256}`,
  ];

  if (manifest.scope.filters.length > 0) {
    lines.push('', 'Filters applied:');
    for (const f of manifest.scope.filters) lines.push(`  - ${f.field} = ${f.value}`);
  }

  if (manifest.excludedFields.length > 0) {
    lines.push('', 'Fields deliberately withheld:');
    for (const f of manifest.excludedFields) lines.push(`  - ${f.label}: ${f.reason}`);
  }

  lines.push(
    '',
    manifest.includesRestricted
      ? 'This export INCLUDES personal or financial identifiers, requested explicitly by the person named above. Handle it accordingly.'
      : 'This export contains no personal or financial identifiers.',
    '',
    manifest.provenance.included
      ? `Source columns are included. ${manifest.provenance.tracedRecords} of ${manifest.scope.recordCount} records carry import provenance; the rest were entered directly and their source cells are empty.`
      : 'Source columns were not included in this export.',
    '',
    'manifest.json is the machine-readable version of this file and is the record of truth.',
    '',
  );
  return lines.join('\n');
}

export interface ExportPackage {
  filename: string;
  content: Buffer;
}

/**
 * Wrap a data file and its manifest into one archive.
 *
 * A single artifact, because a manifest that travels separately is a manifest
 * that gets separated. `.zip` and not a bare file, because there is no honest
 * way to put a manifest inside a CSV.
 */
export function packageExport(
  dataFilename: string,
  data: Buffer,
  manifest: DataPlaneExportManifest,
): ExportPackage {
  const base = dataFilename.replace(/\.[^.]+$/, '');
  return {
    filename: `${base}.zip`,
    content: buildZip([
      { name: dataFilename, content: data },
      { name: 'manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
      { name: 'README.txt', content: readmeFor(manifest) },
    ]),
  };
}
