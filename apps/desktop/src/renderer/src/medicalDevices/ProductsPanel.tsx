/**
 * Medical Devices → Products.
 *
 * List, detail, create, edit and history. Writes go through the GENERIC
 * enterprise module channels (`ipc.enterpriseModules.*`) — the same audited,
 * RBAC-gated path every other module's records take. Only the read side is
 * pack-specific, because the generic record search is a substring match over
 * every field and this surface must search the catalogue, not the notes.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  DeviceProductDetail,
  DeviceProductListItem,
  MedicalDevicePackView,
  ResolvedTaxonomy,
} from '@neuropause/shared';
import {
  DEVICE_PRODUCTS_MODULE_ID,
  MD_TAXONOMY,
  REGULATORY_METADATA_FIELD,
  deviceProductFromRecord,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { Input } from '@renderer/components/ui/Input';
import { Icon } from '@renderer/components/ui/Icon';
import { Loading } from '@renderer/components/ui/Loading';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Badge } from '@renderer/components/ui/controls';
import {
  DataTable,
  DetailRow,
  ErrorBlock,
  NoticeBlock,
  Section,
  Td,
  Th,
} from '@renderer/dataCommandCenter/primitives';
import { emptyMessage, friendlyError, sortProducts } from './medicalDevicesModel';

interface Props {
  pack: MedicalDevicePackView | null;
  onOpenLots: (productId: string) => void;
  onTrace: (productId: string, label: string) => void;
}

type Mode = { kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'form'; id: string | null };

const taxonomy = (pack: MedicalDevicePackView | null, key: string): ResolvedTaxonomy | null =>
  pack?.taxonomies.find((t) => t.key === key) ?? null;

const labelFor = (tax: ResolvedTaxonomy | null, value: string): string =>
  tax?.values.find((v) => v.value === value)?.label ?? value;

export function ProductsPanel({ pack, onOpenLots, onTrace }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [products, setProducts] = useState<DeviceProductListItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('');
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const found = await ipc.medicalDevice.products.search({
        ...(query.trim() ? { query: query.trim() } : {}),
        ...(family ? { family } : {}),
      });
      setProducts(sortProducts(found));
    } catch (err) {
      setError(friendlyError(err));
      setProducts([]);
    }
  }, [query, family]);

  useEffect(() => {
    void load();
  }, [load]);

  const families = taxonomy(pack, MD_TAXONOMY.family);

  if (mode.kind === 'form') {
    return (
      <ProductForm
        pack={pack}
        productId={mode.id}
        onDone={(id) => {
          void load();
          setMode(id ? { kind: 'detail', id } : { kind: 'list' });
        }}
        onCancel={() => setMode(mode.id ? { kind: 'detail', id: mode.id } : { kind: 'list' })}
      />
    );
  }

  if (mode.kind === 'detail') {
    return (
      <ProductDetail
        pack={pack}
        productId={mode.id}
        onBack={() => setMode({ kind: 'list' })}
        onEdit={() => setMode({ kind: 'form', id: mode.id })}
        onOpenLots={onOpenLots}
        onTrace={onTrace}
      />
    );
  }

  const filtered = Boolean(query.trim() || family);
  const empty = emptyMessage('products', filtered);

  return (
    <div>
      <Section
        title="Products"
        subtitle="The device catalogue. Classification here is your own configuration — NeuroPause makes no regulatory or certification claim about any product."
        icon="package"
        right={
          <Button size="sm" icon="plus" onClick={() => setMode({ kind: 'form', id: null })}>
            New product
          </Button>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code, name, family, category or material"
            className="min-w-[280px] flex-1"
            aria-label="Search products"
          />
          <select
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            aria-label="Filter by family"
            className="h-9 rounded-lg border border-[var(--hairline)] bg-transparent px-3 text-sm"
          >
            <option value="">All families</option>
            {(families?.values ?? []).map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {error && <ErrorBlock title={error.title} detail={error.detail} onRetry={() => void load()} />}

        {products === null ? (
          <Loading label="Loading products" />
        ) : products.length === 0 ? (
          <EmptyState icon="package" title={empty.title} description={empty.body} />
        ) : (
          <DataTable
            head={
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Family</Th>
                <Th>Material</Th>
                <Th>Sterility</Th>
                <Th>Lots</Th>
                <Th>Status</Th>
              </tr>
            }
          >
            {products.map((p) => (
              <tr
                key={p.id}
                className="cursor-pointer hover:[background:var(--fill-1)]"
                onClick={() => setMode({ kind: 'detail', id: p.id })}
              >
                <Td className="font-medium">{p.productCode}</Td>
                <Td>{p.productName}</Td>
                <Td className="text-muted">{labelFor(families, p.productFamily) || '—'}</Td>
                <Td className="text-muted">
                  {labelFor(taxonomy(pack, MD_TAXONOMY.material), p.material) || '—'}
                </Td>
                <Td className="text-muted">
                  {labelFor(taxonomy(pack, MD_TAXONOMY.sterile), p.sterileStatus)}
                </Td>
                <Td className="tabular-nums">{p.batchLotTracked ? p.lotCount : '—'}</Td>
                <Td>
                  <Badge tone={p.status === 'active' ? 'green' : 'neutral'}>{p.status}</Badge>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}

/* ── detail ───────────────────────────────────────────────────────────────── */

function ProductDetail({
  pack,
  productId,
  onBack,
  onEdit,
  onOpenLots,
  onTrace,
}: {
  pack: MedicalDevicePackView | null;
  productId: string;
  onBack: () => void;
  onEdit: () => void;
  onOpenLots: (productId: string) => void;
  onTrace: (productId: string, label: string) => void;
}): JSX.Element {
  const [detail, setDetail] = useState<DeviceProductDetail | null | 'missing'>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    ipc.medicalDevice.products
      .get(productId)
      .then((d) => setDetail(d ?? 'missing'))
      .catch((err: unknown) => {
        setError(friendlyError(err));
        setDetail('missing');
      });
  }, [productId]);

  if (detail === null) return <Loading label="Loading product" />;
  if (detail === 'missing') {
    return (
      <div>
        <Button size="sm" icon="close" onClick={onBack} className="mb-4">
          Back to products
        </Button>
        {error ? (
          <ErrorBlock title={error.title} detail={error.detail} />
        ) : (
          <EmptyState icon="package" title="Product not found" description="It may have been deleted." />
        )}
      </div>
    );
  }

  const p = detail.product;
  const meta = Object.entries(p.regulatoryMetadata);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Button size="sm" icon="close" onClick={onBack}>
          Back to products
        </Button>
        <div className="flex gap-2">
          {p.batchLotTracked && (
            <Button size="sm" icon="tag" onClick={() => onOpenLots(p.id)}>
              {detail.lots.length} lot{detail.lots.length === 1 ? '' : 's'}
            </Button>
          )}
          <Button size="sm" icon="layers" onClick={() => onTrace(p.id, p.productCode)}>
            Trace
          </Button>
          <Button size="sm" variant="primary" icon="pin" onClick={onEdit}>
            Edit
          </Button>
        </div>
      </div>

      <h2 className="text-xl font-semibold tracking-tight">{p.productName}</h2>
      <p className="mt-1 text-sm text-muted">{p.productCode}</p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Card variant="flat">
          <h3 className="mb-2 text-sm font-semibold">Identifiers</h3>
          <DetailRow label="Product code" value={p.productCode} />
          <DetailRow label="UDI" value={p.udi || <span className="text-faint">Not recorded</span>} />
          <DetailRow label="Record id" value={<span className="font-mono text-xs">{p.id}</span>} />
        </Card>

        <Card variant="flat">
          <h3 className="mb-2 text-sm font-semibold">Classification</h3>
          <DetailRow label="Family" value={labelFor(taxonomy(pack, MD_TAXONOMY.family), p.productFamily) || '—'} />
          <DetailRow label="Category" value={labelFor(taxonomy(pack, MD_TAXONOMY.category), p.category) || '—'} />
          <DetailRow
            label="Anatomical"
            value={labelFor(taxonomy(pack, MD_TAXONOMY.anatomical), p.anatomicalCategory) || '—'}
          />
        </Card>

        <Card variant="flat">
          <h3 className="mb-2 text-sm font-semibold">Material &amp; dimensions</h3>
          <DetailRow label="Material" value={labelFor(taxonomy(pack, MD_TAXONOMY.material), p.material) || '—'} />
          <DetailRow label="Size" value={p.size || '—'} />
          <DetailRow label="Dimensions" value={p.dimensions || '—'} />
        </Card>

        <Card variant="flat">
          <h3 className="mb-2 text-sm font-semibold">Sterility &amp; packaging</h3>
          <DetailRow label="Sterility" value={labelFor(taxonomy(pack, MD_TAXONOMY.sterile), p.sterileStatus)} />
          <DetailRow label="Packaging" value={p.packaging || '—'} />
        </Card>

        <Card variant="flat">
          <h3 className="mb-2 text-sm font-semibold">Traceability</h3>
          <DetailRow label="Batch / lot tracked" value={p.batchLotTracked ? 'Yes' : 'No'} />
          <DetailRow label="Serial tracked" value={p.serialTracked ? 'Yes' : 'No'} />
          <DetailRow label="Lots recorded" value={detail.lots.length} />
          {!p.batchLotTracked && (
            <NoticeBlock icon="info">
              Batch/lot tracking is off for this product, so no batch can be recorded against it and it cannot be
              traced by batch.
            </NoticeBlock>
          )}
        </Card>

        <Card variant="flat">
          <h3 className="mb-2 text-sm font-semibold">Regulatory metadata</h3>
          {meta.length === 0 ? (
            <NoticeBlock icon="info">
              Nothing recorded. What is required differs by device, market and year, so NeuroPause imposes no schema
              and treats empty as a normal state.
            </NoticeBlock>
          ) : (
            meta.map(([k, v]) => <DetailRow key={k} label={k} value={v} />)
          )}
        </Card>
      </div>

      <Section title="History" icon="clock" subtitle="Every recorded change to this product.">
        {detail.history.length === 0 ? (
          <NoticeBlock icon="clock">
            No changes have been recorded for this product yet. Creation and every later edit are audited from here on.
          </NoticeBlock>
        ) : (
          <DataTable
            head={
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>What</Th>
              </tr>
            }
          >
            {detail.history.map((h, i) => (
              <tr key={`${h.at}-${i}`}>
                <Td className="whitespace-nowrap text-muted">{new Date(h.at).toLocaleString()}</Td>
                <Td className="text-muted">{h.actor ?? 'Unknown'}</Td>
                <Td>{h.summary}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}

/* ── create / edit ────────────────────────────────────────────────────────── */

interface FormState {
  productCode: string;
  productName: string;
  productFamily: string;
  category: string;
  anatomicalCategory: string;
  material: string;
  size: string;
  dimensions: string;
  sterileStatus: string;
  packaging: string;
  batchLotTracked: boolean;
  serialTracked: boolean;
  udi: string;
  regulatoryMetadata: string;
  status: string;
}

const EMPTY_FORM: FormState = {
  productCode: '',
  productName: '',
  productFamily: '',
  category: '',
  anatomicalCategory: '',
  material: '',
  size: '',
  dimensions: '',
  sterileStatus: 'not_specified',
  packaging: '',
  batchLotTracked: true,
  serialTracked: false,
  udi: '',
  regulatoryMetadata: '',
  status: 'active',
};

function ProductForm({
  pack,
  productId,
  onDone,
  onCancel,
}: {
  pack: MedicalDevicePackView | null;
  productId: string | null;
  onDone: (id: string | null) => void;
  onCancel: () => void;
}): JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(productId !== null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!productId) return;
    ipc.enterpriseModules
      .get(DEVICE_PRODUCTS_MODULE_ID, productId)
      .then((record) => {
        if (record) {
          const p = deviceProductFromRecord(record);
          setForm({
            productCode: p.productCode,
            productName: p.productName,
            productFamily: p.productFamily,
            category: p.category,
            anatomicalCategory: p.anatomicalCategory,
            material: p.material,
            size: p.size,
            dimensions: p.dimensions,
            sterileStatus: p.sterileStatus,
            packaging: p.packaging,
            batchLotTracked: p.batchLotTracked,
            serialTracked: p.serialTracked,
            udi: p.udi,
            regulatoryMetadata: String(record.fields[REGULATORY_METADATA_FIELD] ?? ''),
            status: p.status,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [productId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async (): Promise<void> => {
    setSaving(true);
    setErrors({});
    try {
      const fields: Record<string, string | number | boolean | null> = { ...form };
      const result = productId
        ? await ipc.enterpriseModules.update(DEVICE_PRODUCTS_MODULE_ID, productId, { fields })
        : await ipc.enterpriseModules.create(DEVICE_PRODUCTS_MODULE_ID, { fields });
      if (result.ok && result.record) onDone(result.record.id);
      else setErrors(result.errors ?? { _: 'The record was rejected without a reason.' });
    } catch (err) {
      const friendly = friendlyError(err);
      setErrors({ _: `${friendly.title}. ${friendly.detail}` });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Loading product" />;

  const select = (
    key: keyof FormState,
    label: string,
    tax: ResolvedTaxonomy | null,
    allowEmpty = true,
  ): JSX.Element => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <select
        value={String(form[key])}
        onChange={(e) => set(key, e.target.value as never)}
        className="h-9 w-full rounded-lg border border-[var(--hairline)] bg-transparent px-3 text-sm"
      >
        {allowEmpty && <option value="">Not specified</option>}
        {(tax?.values ?? []).map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
      {errors[key] && <span className="mt-1 block text-xs text-syspink">{errors[key]}</span>}
    </label>
  );

  const text = (key: keyof FormState, label: string, placeholder?: string): JSX.Element => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <Input
        value={String(form[key])}
        onChange={(e) => set(key, e.target.value as never)}
        placeholder={placeholder ?? ''}
      />
      {errors[key] && <span className="mt-1 block text-xs text-syspink">{errors[key]}</span>}
    </label>
  );

  return (
    <div>
      <Button size="sm" icon="close" onClick={onCancel} className="mb-4">
        Cancel
      </Button>
      <Section
        title={productId ? 'Edit product' : 'New product'}
        icon="package"
        subtitle="A product code and a name are all that is required. Everything else can be filled in later — guessed classification on a record a recall reads is worse than none."
      >
        {errors._ && <ErrorBlock title="That could not be saved" detail={errors._} />}
        <Card variant="flat" className="mt-3">
          <div className="grid gap-4 md:grid-cols-2">
            {text('productCode', 'Product code', 'TR-1001')}
            {text('productName', 'Product name', '4.5mm Cortical Screw')}
            {select('productFamily', 'Family', taxonomy(pack, MD_TAXONOMY.family))}
            {select('category', 'Category', taxonomy(pack, MD_TAXONOMY.category))}
            {select('anatomicalCategory', 'Anatomical category', taxonomy(pack, MD_TAXONOMY.anatomical))}
            {select('material', 'Material', taxonomy(pack, MD_TAXONOMY.material))}
            {text('size', 'Size', '4.5 × 40 mm')}
            {text('dimensions', 'Dimensions', 'Ø4.5 mm, L40 mm')}
            {select('sterileStatus', 'Sterility', taxonomy(pack, MD_TAXONOMY.sterile), false)}
            {text('packaging', 'Packaging', 'Single sterile blister')}
            {text('udi', 'UDI', 'Optional')}
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Status</span>
              <select
                value={form.status}
                onChange={(e) => set('status', e.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--hairline)] bg-transparent px-3 text-sm"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="discontinued">Discontinued</option>
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.batchLotTracked}
                onChange={(e) => set('batchLotTracked', e.target.checked)}
              />
              Batch / lot tracked
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.serialTracked}
                onChange={(e) => set('serialTracked', e.target.checked)}
              />
              Serial tracked
            </label>
          </div>
          {errors.serialTracked && (
            <p className="mt-2 text-xs text-syspink">{errors.serialTracked}</p>
          )}

          <label className="mt-4 block">
            <span className="mb-1 block text-sm font-medium">Regulatory metadata</span>
            <textarea
              value={form.regulatoryMetadata}
              onChange={(e) => set('regulatoryMetadata', e.target.value)}
              rows={3}
              placeholder='{"riskClass":"IIb","market":"EU"}'
              className="w-full rounded-lg border border-[var(--hairline)] bg-transparent px-3 py-2 font-mono text-xs"
            />
            <span className="mt-1 block text-xs text-faint">
              Free-form JSON. Leave it empty if you have nothing to record.
            </span>
            {errors[REGULATORY_METADATA_FIELD] && (
              <span className="mt-1 block text-xs text-syspink">{errors[REGULATORY_METADATA_FIELD]}</span>
            )}
          </label>

          <div className="mt-5 flex gap-2">
            <Button variant="primary" icon="check" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : productId ? 'Save changes' : 'Create product'}
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </div>
        </Card>
      </Section>

      <NoticeBlock icon="shield">
        <Icon name="info" size={12} className="mr-1 inline" />
        Recording a UDI or a risk class here stores the value. It does not make anything compliant, and NeuroPause is
        not validated software.
      </NoticeBlock>
    </div>
  );
}
