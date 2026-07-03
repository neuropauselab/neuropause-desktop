/**
 * AI Worker Marketplace. Browse, install, update, and rate AI worker listings —
 * and share one of your own live workforce workers to the marketplace, which
 * creates a listing and runs it through the real scan → sign → submit pipeline.
 */
import { useState } from 'react';
import type { WorkerSummary } from '@neuropause/shared';
import { OpsPanel, Stat } from '@renderer/operations/primitives';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { ipc } from '@renderer/lib/ipc';
import { useEcosystem } from './EcosystemProvider';
import { MarketplaceCard } from './MarketplaceCard';
import { Modal } from '@renderer/developer/primitives';
import { formatNum, titleCase } from './lib';

export function WorkerMarketplacePanel(): JSX.Element {
  const { listings, installedFor, install, update, setEnabled, uninstall, installSummary, workers, shareWorker } = useEcosystem();
  const workerListings = listings.filter((l) => l.kind === 'ai_worker');
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div>
      <OpsPanel
        title="AI Worker Marketplace"
        subtitle="Install governed AI workers, or share your own to the network"
        actions={<Button size="sm" variant="primary" icon="upload" onClick={() => setShareOpen(true)}>Share a worker</Button>}
      >
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon="cpu" label="Worker listings" value={workerListings.length} tone="purple" />
          <Stat icon="download" label="Installed" value={installSummary?.byKind['ai_worker'] ?? 0} tone="green" />
          <Stat icon="store" label="Total installs" value={formatNum(workerListings.reduce((n, l) => n + l.installs, 0))} tone="blue" />
          <Stat icon="verified" label="Certified" value={workerListings.filter((l) => l.certified).length} tone="accent" />
        </div>

        {workerListings.length === 0 ? (
          <EmptyState icon="cpu" title="No worker listings yet" description="Share one of your workforce workers to populate the marketplace." compact action={<Button size="sm" icon="upload" onClick={() => setShareOpen(true)}>Share a worker</Button>} />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {workerListings.map((l) => (
              <MarketplaceCard
                key={l.id}
                listing={l}
                installed={installedFor(l.id)}
                onInstall={() => void install(l.id)}
                onUpdate={() => { const ins = installedFor(l.id); if (ins) void update(ins.id); }}
                onToggleEnabled={(enabled) => { const ins = installedFor(l.id); if (ins) void setEnabled(ins.id, enabled); }}
                onUninstall={() => { const ins = installedFor(l.id); if (ins) void uninstall(ins.id); }}
                onRate={(stars) => void ipc.ecosystem.rate(l.id, stars)}
              />
            ))}
          </div>
        )}
      </OpsPanel>

      {shareOpen && <ShareWorkerModal workers={workers} onClose={() => setShareOpen(false)} onShare={shareWorker} />}
    </div>
  );
}

function ShareWorkerModal({ workers, onClose, onShare }: { workers: WorkerSummary[]; onClose: () => void; onShare: (workerId: string) => Promise<unknown> }): JSX.Element {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [shared, setShared] = useState<Set<string>>(new Set());

  const share = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      await onShare(id);
      setShared((prev) => new Set(prev).add(id));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal open title="Share a worker to the marketplace" subtitle="Creates an AI worker listing and runs it through scan → sign → submit." onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      {workers.length === 0 ? (
        <EmptyState icon="cpu" title="No workers to share" description="Your workforce has no workers yet." compact />
      ) : (
        <div className="space-y-2">
          {workers.map((w) => (
            <div key={w.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--hairline)] px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{w.name}</span>
                  <span className="rounded-md [background:var(--fill-2)] px-1.5 py-0.5 text-2xs text-faint">{titleCase(w.role)}</span>
                </div>
                <div className="text-2xs text-faint">v{w.version} · {w.skillCount} skill{w.skillCount === 1 ? '' : 's'} · trust {(w.trustScore * 100).toFixed(0)}%</div>
              </div>
              {shared.has(w.id) ? (
                <span className="inline-flex items-center gap-1 text-2xs font-medium text-sysgreen"><Icon name="check" size={13} />Shared</span>
              ) : (
                <Button size="sm" variant="secondary" disabled={busyId === w.id} onClick={() => void share(w.id)}>{busyId === w.id ? 'Sharing…' : 'Share'}</Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
