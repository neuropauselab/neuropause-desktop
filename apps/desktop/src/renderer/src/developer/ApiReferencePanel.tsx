/**
 * API Reference. A browsable view of the OpenAPI 3.1 document the platform
 * generates live from the route table and the existing Zod contract schemas
 * (Increment 2) — so it never drifts from the API. Operations are grouped by tag;
 * the raw spec can be viewed or downloaded for Postman / codegen / Swagger UI.
 */
import { useMemo, useState } from 'react';
import type { ApiMethod, JsonSchema, OpenApiOperation, OpenApiParameter } from '@neuropause/shared';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';
import { useDeveloper } from './DeveloperProvider';
import { InlineCode, CodeBlock } from './primitives';
import { methodTone, TINT_TONE } from './lib';
import { countOpenApiOperations, openApiOperationsByTag, prettyJson } from './portalModel';

/** A compact, human string for a JSON-schema fragment (type / enum / $ref / array). */
function schemaType(schema: JsonSchema | undefined): string {
  if (!schema) return 'any';
  const ref = schema.$ref;
  if (typeof ref === 'string') return ref.split('/').pop() ?? 'ref';
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  const type = schema.type;
  if (type === 'array') {
    const items = schema.items as JsonSchema | undefined;
    return `${schemaType(items)}[]`;
  }
  if (typeof type === 'string') return type;
  return 'object';
}

function scopesOf(op: OpenApiOperation): string[] {
  const out: string[] = [];
  for (const req of op.security) for (const list of Object.values(req)) out.push(...list);
  return [...new Set(out)];
}

export function ApiReferencePanel(): JSX.Element {
  const { openapi } = useDeveloper();
  const [showRaw, setShowRaw] = useState(false);
  const groups = useMemo(() => openApiOperationsByTag(openapi), [openapi]);

  if (!openapi) {
    return (
      <OpsPanel title="API Reference" subtitle="OpenAPI 3.1">
        <EmptyState icon="doc" title="Loading specification…" compact />
      </OpsPanel>
    );
  }

  const opCount = countOpenApiOperations(openapi);
  const schemaCount = Object.keys(openapi.components.schemas).length;

  const download = (): void => {
    const blob = new Blob([JSON.stringify(openapi, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'openapi.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <OpsPanel
        title={openapi.info.title}
        subtitle={openapi.info.description ?? 'OpenAPI 3.1 specification'}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" icon={showRaw ? 'list' : 'code'} onClick={() => setShowRaw((v) => !v)}>{showRaw ? 'Grouped' : 'Raw JSON'}</Button>
            <Button size="sm" variant="primary" icon="download" onClick={download}>openapi.json</Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="tag" label="Version" value={openapi.info.version} tone="blue" />
          <Stat icon="server" label="Operations" value={opCount} tone="accent" />
          <Stat icon="layers" label="Schemas" value={schemaCount} tone="purple" />
          <Stat icon="lock" label="Security" value={Object.keys(openapi.components.securitySchemes).length} tone="green" />
        </div>
        {openapi.servers.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-2xs text-faint">
            <Icon name="globe" size={12} /> Servers:
            {openapi.servers.map((s) => <InlineCode key={s.url}>{s.url}</InlineCode>)}
          </div>
        )}
      </OpsPanel>

      {showRaw ? (
        <OpsPanel title="Raw specification" subtitle="OpenAPI 3.1 · application/json">
          <CodeBlock value={prettyJson(openapi)} />
        </OpsPanel>
      ) : (
        groups.map((g) => (
          <OpsPanel key={g.tag} title={g.tag} subtitle={g.description}>
            <div className="space-y-2">
              {g.operations.map((row) => (
                <OperationRow key={`${row.method} ${row.path}`} method={row.method} path={row.path} op={row.operation} />
              ))}
            </div>
          </OpsPanel>
        ))
      )}
    </div>
  );
}

function OperationRow({ method, path, op }: { method: ApiMethod; path: string; op: OpenApiOperation }): JSX.Element {
  const [open, setOpen] = useState(false);
  const scopes = scopesOf(op);
  const params = op.parameters ?? [];
  const bodySchema = op.requestBody?.content['application/json']?.schema;

  return (
    <div className="rounded-xl border border-[var(--hairline)] [background:var(--fill-1)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className={cn('inline-flex min-w-[52px] justify-center rounded-md px-1.5 py-0.5 font-mono text-2xs font-bold', TINT_TONE[methodTone(method)])}>{method}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs text-ink">{path}</span>
          <span className="block truncate text-2xs text-faint">{op.summary}</span>
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={15} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div className="border-t border-[var(--hairline)] px-3 py-3 text-xs">
          {scopes.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-2xs uppercase tracking-wider text-faint">Scopes</span>
              {scopes.map((s) => <InlineCode key={s}>{s}</InlineCode>)}
            </div>
          )}
          {params.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-2xs font-medium uppercase tracking-wider text-faint">Parameters</div>
              <div className="space-y-1">
                {params.map((p: OpenApiParameter) => (
                  <div key={`${p.in}:${p.name}`} className="flex items-center gap-2">
                    <InlineCode>{p.name}</InlineCode>
                    <span className="rounded [background:var(--fill-2)] px-1 py-0.5 text-2xs text-faint">{p.in}</span>
                    <span className="font-mono text-2xs text-muted">{schemaType(p.schema)}</span>
                    {p.required && <StatusBadge tone="orange" label="required" />}
                    {p.description && <span className="truncate text-2xs text-faint">{p.description}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {bodySchema && (
            <div className="mb-3">
              <div className="mb-1 text-2xs font-medium uppercase tracking-wider text-faint">Request body{op.requestBody?.required ? ' · required' : ''}</div>
              <CodeBlock value={prettyJson(bodySchema)} />
            </div>
          )}
          <div>
            <div className="mb-1 text-2xs font-medium uppercase tracking-wider text-faint">Responses</div>
            <div className="space-y-1">
              {Object.entries(op.responses).map(([code, res]) => (
                <div key={code} className="flex items-center gap-2">
                  <span className="font-mono text-2xs font-semibold text-ink">{code}</span>
                  <span className="text-2xs text-muted">{res.description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
