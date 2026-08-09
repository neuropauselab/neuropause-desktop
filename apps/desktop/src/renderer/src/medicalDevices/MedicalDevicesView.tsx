/**
 * Medical Devices — the section shell.
 *
 * Composition only: it decides which panel is on screen and holds the one piece
 * of state the panels share (what the user asked to trace, and which product's
 * lots they came from). Every judgement is made in `medicalDevicesModel`, which
 * is tested, or by the services behind the `md:*` channels.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MedicalDevicePackView } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { SegmentedTabs, type SegmentedTabItem } from '@renderer/components/ui/pillTabs';
import { Button } from '@renderer/components/ui/Button';
import { ErrorBlock, NoticeBlock } from '@renderer/dataCommandCenter/primitives';
import { friendlyError } from './medicalDevicesModel';
import { ProductsPanel } from './ProductsPanel';
import { LotCenterPanel } from './LotCenterPanel';
import { TraceabilityPanel, type TraceTarget } from './TraceabilityPanel';

const log = createLogger('medical-devices');

type Tab = 'products' | 'lots' | 'traceability';

export function MedicalDevicesView(): JSX.Element {
  const [tab, setTab] = useState<Tab>('products');
  const [pack, setPack] = useState<MedicalDevicePackView | null>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [productFilter, setProductFilter] = useState<string | null>(null);
  const [traceTarget, setTraceTarget] = useState<TraceTarget | null>(null);

  const loadPack = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      setPack(await ipc.medicalDevice.pack());
    } catch (err) {
      log.warn('Could not load the medical device pack', {
        message: err instanceof Error ? err.message : String(err),
      });
      setError(friendlyError(err));
      setPack(null);
    }
  }, []);

  useEffect(() => {
    void loadPack();
  }, [loadPack]);

  const tabs = useMemo<SegmentedTabItem<Tab>[]>(
    () => [
      { id: 'products', label: 'Products', icon: 'package', count: pack?.counts.products || undefined },
      { id: 'lots', label: 'Batch / Lot', icon: 'tag', count: pack?.counts.lots || undefined },
      { id: 'traceability', label: 'Traceability', icon: 'layers' },
    ],
    [pack],
  );

  const openTrace = (type: TraceTarget['type'], id: string, label: string): void => {
    setTraceTarget({ type, id, label });
    setTab('traceability');
  };

  return (
    <ViewScroll max={1240}>
      <ViewHeader
        title="Medical Devices"
        subtitle="Your device catalogue and the batches made from it — with a forward and backward trace built from records of what actually happened."
        right={
          <Button size="sm" icon="refresh" onClick={() => void loadPack()}>
            Refresh
          </Button>
        }
      />

      <div className="mb-6">
        <SegmentedTabs items={tabs} activeId={tab} onChange={setTab} ariaLabel="Medical device sections" />
      </div>

      {error && <ErrorBlock title={error.title} detail={error.detail} onRetry={() => void loadPack()} />}

      {tab === 'products' && (
        <ProductsPanel
          pack={pack}
          onOpenLots={(productId) => {
            setProductFilter(productId);
            setTab('lots');
          }}
          onTrace={(productId, label) => openTrace('product', productId, label)}
        />
      )}

      {tab === 'lots' && (
        <LotCenterPanel
          pack={pack}
          productFilter={productFilter}
          onClearProductFilter={() => setProductFilter(null)}
          onTrace={(lotId, label) => openTrace('lot', lotId, label)}
        />
      )}

      {tab === 'traceability' && (
        <TraceabilityPanel target={traceTarget} onTargetChange={setTraceTarget} />
      )}

      {pack && (
        <div className="mt-8">
          <NoticeBlock icon="shield">
            <strong>{pack.manifest.title}</strong> v{pack.manifest.version}. {pack.manifest.description} Not provided
            in this build: {pack.manifest.notProvided.join(' ')}
          </NoticeBlock>
        </div>
      )}
    </ViewScroll>
  );
}
