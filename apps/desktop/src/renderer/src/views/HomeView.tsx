import { useCallback, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { Session } from '@neuropause/shared';
import { greeting } from '@renderer/lib/format';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { isDashboardEmpty } from '@renderer/data/emptyDashboard';
import { SkeletonHeader, SkeletonLines } from '@renderer/components/ui/Skeleton';
import { useDashboard } from '@renderer/state/DashboardProvider';
import { useShell } from '@renderer/state/ShellProvider';
import type { Recommendation } from '@renderer/data/types';
import {
  ConnectedAppsCard,
  PendingTasksCard,
  ProductivityCard,
  RecentActivityCard,
  RecommendationsCard,
  RunningSessionsCard,
} from './home/cards';

function MasonryItem({ index, children }: { index: number; children: ReactNode }): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: index * 0.04, ease: [0.2, 0.8, 0.2, 1] }}
      className="mb-5 w-full break-inside-avoid"
    >
      {children}
    </motion.div>
  );
}

function SkeletonCard({ rows }: { rows: number }): JSX.Element {
  return (
    <div className="surface-raised mb-5 w-full break-inside-avoid rounded-2xl p-5 shadow-card">
      <SkeletonHeader />
      <SkeletonLines rows={rows} />
    </div>
  );
}

function HomeSkeleton(): JSX.Element {
  return (
    <div className="columns-1 gap-5 md:columns-2 xl:columns-3">
      {[3, 2, 3, 2, 4, 3].map((rows, i) => (
        <SkeletonCard key={i} rows={rows} />
      ))}
    </div>
  );
}

export function HomeView({ session }: { session: Session }): JSX.Element {
  const { data, loading, error } = useDashboard();
  const { openApp, setSection } = useShell();
  const name = session.user.displayName ?? session.user.email.split('@')[0];

  const handleRecommendation = useCallback(
    (rec: Recommendation): void => {
      if (rec.action === 'Connect') setSection('connectors');
      else setSection('workspace');
    },
    [setSection],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-8 py-7">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {greeting()}, {name}
            </h1>
            <p className="mt-1.5 text-md text-muted">
              Here’s what’s happening across your AI workspace today.
            </p>
          </div>
        </div>

        {error ? (
          <EmptyState
            icon="info"
            title="Couldn’t load your dashboard"
            description="Something went wrong while fetching your activity."
            action={
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          />
        ) : loading || !data ? (
          <HomeSkeleton />
        ) : isDashboardEmpty(data) ? (
          <EmptyState
            icon="sparkles"
            title="No activity yet"
            description="NeuroPause builds your dashboard from real work. Connect an application, capture a memory, or start a workflow and this space fills with your own activity — nothing here is simulated."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="primary" onClick={() => setSection('connectors')}>
                  Connect your first application
                </Button>
                <Button variant="secondary" onClick={() => setSection('memory')}>
                  Open AI Memory
                </Button>
                <Button variant="secondary" onClick={() => setSection('workforce')}>
                  Open Workforce
                </Button>
              </div>
            }
          />
        ) : (
          <div className="columns-1 gap-5 md:columns-2 xl:columns-3">
            <MasonryItem index={0}>
              <ProductivityCard summary={data.productivity} />
            </MasonryItem>
            <MasonryItem index={1}>
              <RunningSessionsCard sessions={data.runningSessions} onOpenApp={openApp} />
            </MasonryItem>
            <MasonryItem index={2}>
              <RecommendationsCard items={data.recommendations} onAction={handleRecommendation} />
            </MasonryItem>
            <MasonryItem index={3}>
              <ConnectedAppsCard apps={data.connectedApps} onOpenApp={openApp} />
            </MasonryItem>
            <MasonryItem index={4}>
              <PendingTasksCard tasks={data.tasks} />
            </MasonryItem>
            <MasonryItem index={5}>
              <RecentActivityCard events={data.activity} />
            </MasonryItem>
          </div>
        )}
      </div>
    </div>
  );
}
