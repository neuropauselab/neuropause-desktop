/**
 * API Explorer. Browse the live route index of the Enterprise REST API and run
 * real calls through it — every request goes through the same gateway (auth →
 * scope → rate → quota → version) and the same handler registry the API serves in
 * production, so what you see here is exactly what an integrator's key would get.
 */
import { useMemo, useState } from 'react';
import type { ApiMethod, ApiRouteInfo, ApiVersion, EnterpriseApiResponse } from '@neuropause/shared';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';
import { useDeveloper } from './DeveloperProvider';
import { Field, Input, Select, Textarea, InlineCode, CodeBlock } from './primitives';
import { methodTone, statusHttpTone, TEXT_TONE, TINT_TONE } from './lib';
import { buildApiRequest, extractPathParams, prettyJson, type QueryPair } from './portalModel';

const BODY_METHODS: readonly ApiMethod[] = ['POST', 'PUT', 'PATCH'];

export function ApiExplorerPanel(): JSX.Element {
  const { routes, runApiRequest } = useDeveloper();

  const [selected, setSelected] = useState<ApiRouteInfo | null>(null);
  const [filter, setFilter] = useState('');
  const [params, setParams] = useState<Record<string, string>>({});
  const [query, setQuery] = useState<QueryPair[]>([]);
  const [bodyText, setBodyText] = useState('');
  const [version, setVersion] = useState<ApiVersion>('v1');
  const [apiKey, setApiKey] = useState('');
  const [response, setResponse] = useState<EnterpriseApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return routes;
    return routes.filter((r) => `${r.method} ${r.path} ${r.summary} ${r.scope}`.toLowerCase().includes(q));
  }, [routes, filter]);

  const pathParams = selected ? extractPathParams(selected.path) : [];

  const pick = (route: ApiRouteInfo): void => {
    setSelected(route);
    setParams({});
    setQuery(route.list ? [{ key: 'limit', value: '25' }] : []);
    setBodyText(BODY_METHODS.includes(route.method) ? '{\n  \n}' : '');
    setResponse(null);
    setError(null);
  };

  const send = async (): Promise<void> => {
    if (!selected) return;
    const built = buildApiRequest({ method: selected.method, pathTemplate: selected.path, params, query, bodyText, version, apiKey });
    if (!built.ok) {
      setError(built.error);
      setResponse(null);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      setResponse(await runApiRequest(built.request));
    } finally {
      setBusy(false);
    }
  };

  const setParam = (name: string, value: string): void => setParams((p) => ({ ...p, [name]: value }));
  const setPair = (i: number, patch: Partial<QueryPair>): void =>
    setQuery((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addPair = (): void => setQuery((rows) => [...rows, { key: '', value: '' }]);
  const removePair = (i: number): void => setQuery((rows) => rows.filter((_, idx) => idx !== i));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <OpsPanel title="Routes" subtitle={`${routes.length} endpoints`}>
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter routes…" className="mb-3" />
        <div className="max-h-[560px] space-y-1 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <EmptyState icon="search" title="No matching routes" compact />
          ) : (
            filtered.map((r) => {
              const active = selected?.method === r.method && selected?.path === r.path;
              return (
                <button
                  key={`${r.method} ${r.path}`}
                  type="button"
                  onClick={() => pick(r)}
                  className={cn('flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition', active ? 'surface-raised shadow-sm' : 'fill-hover')}
                >
                  <span className={cn('mt-0.5 inline-flex min-w-[46px] justify-center rounded-md px-1.5 py-0.5 font-mono text-2xs font-bold', TINT_TONE[methodTone(r.method)])}>{r.method}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs text-ink">{r.path}</span>
                    <span className="block truncate text-2xs text-faint">{r.summary}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </OpsPanel>

      <div>
        {!selected ? (
          <OpsPanel title="Request" subtitle="Pick a route to compose a call">
            <EmptyState icon="bolt" title="Select a route" description="Choose an endpoint on the left to build and send a request through the live gateway." />
          </OpsPanel>
        ) : (
          <>
            <OpsPanel
              title={selected.path}
              subtitle={selected.summary}
              actions={<span className="inline-flex items-center gap-1.5 text-2xs text-faint"><Icon name="lock" size={12} /> scope <InlineCode>{selected.scope}</InlineCode></span>}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Method"><div className="pt-1.5"><StatusBadge tone={methodTone(selected.method)} label={selected.method} /></div></Field>
                <Field label="Version">
                  <Select value={version} onChange={(e) => setVersion(e.target.value as ApiVersion)}>
                    {(['v1', 'v2'] as ApiVersion[]).map((v) => <option key={v} value={v}>{v}</option>)}
                  </Select>
                </Field>
                <div className="col-span-2">
                  <Field label="API key" hint="Paste a key secret with the scope above; leave blank to see the 401 an unauthenticated call gets">
                    <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="npk_live_…" />
                  </Field>
                </div>
              </div>

              {pathParams.length > 0 && (
                <div className="mt-1">
                  <div className="mb-1 text-2xs font-medium uppercase tracking-wider text-faint">Path parameters</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {pathParams.map((name) => (
                      <Field key={name} label={name}>
                        <Input value={params[name] ?? ''} onChange={(e) => setParam(name, e.target.value)} placeholder={`:${name}`} />
                      </Field>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-1">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-2xs font-medium uppercase tracking-wider text-faint">Query{selected.list ? ' · list route accepts limit, cursor, sort, order' : ''}</span>
                  <button type="button" onClick={addPair} className="inline-flex items-center gap-1 text-2xs text-muted hover:text-ink"><Icon name="plus" size={12} /> Add</button>
                </div>
                <div className="space-y-2">
                  {query.map((pair, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input value={pair.key} onChange={(e) => setPair(i, { key: e.target.value })} placeholder="name" className="flex-1" />
                      <Input value={pair.value} onChange={(e) => setPair(i, { value: e.target.value })} placeholder="value" className="flex-1" />
                      <button type="button" aria-label="Remove" onClick={() => removePair(i)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted fill-hover hover:text-sysred"><Icon name="close" size={14} /></button>
                    </div>
                  ))}
                  {query.length === 0 && <p className="text-2xs text-faint">No query parameters.</p>}
                </div>
              </div>

              {BODY_METHODS.includes(selected.method) && (
                <div className="mt-3">
                  <Field label="Request body (JSON)"><Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={6} spellCheck={false} /></Field>
                </div>
              )}

              {error && <p className="mt-1 flex items-center gap-1.5 text-xs text-sysred"><Icon name="info" size={13} /> {error}</p>}

              <div className="mt-3 flex justify-end">
                <Button variant="primary" icon="bolt" loading={busy} disabled={busy} onClick={() => void send()}>Send request</Button>
              </div>
            </OpsPanel>

            {response && (
              <OpsPanel title="Response" subtitle={`${selected.method} ${selected.path}`}>
                <div className="flex items-center gap-2">
                  <span className={cn('font-mono text-lg font-bold', TEXT_TONE[statusHttpTone(response.status)])}>{response.status}</span>
                  <StatusBadge tone={response.ok ? 'green' : 'red'} label={response.ok ? 'OK' : 'Error'} />
                  {response.error && <span className="text-sm text-muted">{response.error}</span>}
                </div>
                {Object.keys(response.headers).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(response.headers).map(([k, v]) => (
                      <span key={k} className="rounded-lg [background:var(--fill-1)] px-2 py-0.5 font-mono text-2xs text-muted">{k}: {v}</span>
                    ))}
                  </div>
                )}
                <div className="mt-3">
                  <CodeBlock label="Body" value={response.ok ? prettyJson(response.data) : prettyJson({ error: response.error })} />
                </div>
              </OpsPanel>
            )}
          </>
        )}
      </div>
    </div>
  );
}
