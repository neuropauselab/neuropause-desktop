import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { ReviewDto, StoreAppDetail } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { Button } from '@renderer/components/ui/Button';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Spinner } from '@renderer/components/Spinner';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Avatar } from '@renderer/components/ui/controls';
import { ipc } from '@renderer/lib/ipc';
import { formatCount, formatRelative } from '@renderer/lib/format';
import { ScreenshotCarousel } from './ScreenshotCarousel';
import { RatingStars } from './RatingStars';
import { useStore } from './StoreProvider';
import {
  appTypeLabel,
  connectionStatus,
  formatPrice,
  glyphOf,
  PERMISSION_META,
  pricingLabel,
  toTone,
} from './lib';

export function AppDetail({ slug }: { slug: string }): JSX.Element {
  const { back, isInstalled, launch, beginInstall } = useStore();
  const [app, setApp] = useState<StoreAppDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    setApp(null);
    setNotFound(false);
    void ipc.catalog
      .app(slug)
      .then((d) => {
        if (active) setApp(d);
      })
      .catch(() => {
        if (active) setNotFound(true);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (notFound) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto px-8 py-7" style={{ maxWidth: 1100 }}>
          <BackButton onClick={back} />
          <EmptyState icon="store" title="App not found" description="It may have been removed." />
        </div>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  }

  const tone = toTone(app.iconTone);
  const installed = isInstalled(app.slug);
  const conn = connectionStatus(app.slug);
  const defaultPlan = app.pricingPlans.find((p) => p.isDefault) ?? app.pricingPlans[0];

  return (
    <div className="h-full overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        className="mx-auto px-8 py-7"
        style={{ maxWidth: 1120 }}
      >
        <BackButton onClick={back} />

        {/* Hero */}
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
          <AppGlyph glyph={glyphOf(app)} tone={tone} size={88} radius={24} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{app.name}</h1>
              {app.developer.isVerified && <Icon name="verified" size={18} className="shrink-0 text-sysblue" />}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <span>{app.developer.name}</span>
              <span className="text-faint">·</span>
              <span>{app.category.name}</span>
              <span className="text-faint">·</span>
              <RatingStars average={app.rating.average} count={app.rating.count} />
              <span className="text-faint">·</span>
              <span className="text-faint">{formatCount(app.installCount)} installs</span>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {installed ? (
              <Button variant="primary" icon="launch" onClick={() => launch(app.slug, app.name)}>
                Open
              </Button>
            ) : (
              <Button variant="primary" icon="download" onClick={() => beginInstall(app)}>
                {defaultPlan && defaultPlan.priceCents > 0 ? formatPrice(defaultPlan) : 'Install'}
              </Button>
            )}
            <span className="text-center text-2xs font-medium uppercase tracking-wider text-faint sm:text-right">
              {pricingLabel(app.pricingKind)}
              {installed ? ' · Installed' : ''}
            </span>
          </div>
        </div>

        {/* Screenshots */}
        {app.screenshots.length > 0 && (
          <div className="mt-7">
            <ScreenshotCarousel shots={app.screenshots} />
          </div>
        )}

        {/* Two columns */}
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0">
            <Section title="About">
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{app.description}</p>
            </Section>

            {app.tags.length > 0 && (
              <Section title="Capabilities">
                <div className="flex flex-wrap gap-2">
                  {app.tags.map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1.5 rounded-full [background:var(--fill-2)] px-3 py-1 text-xs font-medium text-muted"
                    >
                      <Icon name="bolt" size={12} /> {t.label}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            <Section title="Permissions">
              {app.permissions.length === 0 ? (
                <p className="text-sm text-muted">This app requests no special permissions.</p>
              ) : (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {app.permissions.map((p) => {
                    const meta = PERMISSION_META[p.permission];
                    return (
                      <div key={p.permission} className="surface-raised flex items-start gap-3 rounded-xl p-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [background:var(--fill-2)] text-muted">
                          <Icon name={meta.icon} size={16} />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{meta.label}</div>
                          <p className="text-xs leading-snug text-faint">{p.reason ?? meta.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            {app.latestVersion?.changelog && (
              <Section title="What’s new">
                <div className="surface-raised rounded-xl p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span>Version {app.latestVersion.version}</span>
                    {app.latestVersion.releasedAt && (
                      <span className="text-faint">· {formatRelative(app.latestVersion.releasedAt)}</span>
                    )}
                  </div>
                  {app.latestVersion.changelog.highlights.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {app.latestVersion.changelog.highlights.map((h, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted">
                          <Icon name="check" size={14} className="mt-0.5 shrink-0 text-sysgreen" /> {h}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Section>
            )}

            {app.versions.length > 1 && (
              <Section title="Version history">
                <div className="overflow-hidden rounded-xl border border-[var(--hairline)]">
                  {app.versions.slice(0, 8).map((v, i) => (
                    <div
                      key={v.id}
                      className={cn(
                        'flex items-center justify-between px-4 py-2.5 text-sm',
                        i > 0 && 'border-t border-[var(--hairline)]',
                      )}
                    >
                      <span className="font-medium">
                        {v.version}
                        {v.isPrerelease && (
                          <span className="ml-2 rounded bg-sysorange/15 px-1.5 py-0.5 text-2xs font-semibold uppercase text-sysorange">
                            Beta
                          </span>
                        )}
                      </span>
                      <span className="text-faint">
                        {v.releasedAt ? new Date(v.releasedAt).toLocaleDateString() : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <Section title="Ratings & reviews">
              <Reviews app={app} />
            </Section>
          </div>

          {/* Aside */}
          <aside className="space-y-4">
            <div className="surface-raised rounded-2xl p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-faint">Information</h3>
              <dl className="space-y-2.5 text-sm">
                <Info label="Developer" value={app.developer.name} />
                <Info label="Category" value={app.category.name} />
                <Info label="Runtime" value={appTypeLabel(app.appType)} />
                <Info label="Platform" value="macOS (Apple Silicon)" />
                <Info label="Pricing" value={pricingLabel(app.pricingKind)} />
                {app.latestVersion && <Info label="Version" value={app.latestVersion.version} />}
                {app.latestVersion?.channel && <Info label="Channel" value={app.latestVersion.channel} />}
                {app.license && <Info label="License" value={app.license} />}
                <Info label="Open source" value={app.isOpenSource ? 'Yes' : 'No'} />
              </dl>

              <div className="mt-4 space-y-1.5 border-t border-[var(--hairline)] pt-3">
                {app.homepageUrl && <LinkRow icon="globe" label="Website" href={app.homepageUrl} />}
                {app.repositoryUrl && <LinkRow icon="code" label="Source repository" href={app.repositoryUrl} />}
                {app.homepageUrl && <LinkRow icon="doc" label="Documentation" href={app.homepageUrl} />}
              </div>
            </div>

            {/* Phase 4 connection seam */}
            <div className="surface-raised rounded-2xl p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Connection</h3>
              {conn === 'connected' ? (
                <div className="flex items-center gap-2 text-sm font-medium text-sysgreen">
                  <span className="h-2 w-2 rounded-full bg-sysgreen" /> Account connected
                </div>
              ) : conn === 'available' ? (
                <>
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <span className="h-2 w-2 rounded-full bg-sysorange" /> Connector available
                  </div>
                  <Button size="sm" variant="secondary" className="mt-3 w-full" icon="connectors" disabled>
                    Connect in Phase 4
                  </Button>
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-faint">
                  <span className="h-2 w-2 rounded-full [background:var(--fill-2)]" /> No connector yet
                </div>
              )}
            </div>
          </aside>
        </div>
      </motion.div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg py-1 text-sm font-medium text-muted hover:text-ink"
    >
      <Icon name="chevron-left" size={16} /> Store
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="mb-7">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-faint">{label}</dt>
      <dd className="truncate font-medium text-ink">{value}</dd>
    </div>
  );
}

function LinkRow({ icon, label, href }: { icon: IconName; label: string; href: string }): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm text-muted fill-hover hover:text-ink"
    >
      <Icon name={icon} size={15} />
      <span className="flex-1">{label}</span>
      <Icon name="external" size={13} className="text-faint" />
    </a>
  );
}

/** Ratings distribution + the list of reviews (fetched on demand). */
function Reviews({ app }: { app: StoreAppDetail }): JSX.Element {
  const [reviews, setReviews] = useState<ReviewDto[]>(app.reviews);
  const total = app.rating.count;

  useEffect(() => {
    let active = true;
    void ipc.catalog
      .reviews(app.slug, 1, 10)
      .then((res) => {
        if (active) setReviews(res.items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [app.slug]);

  return (
    <div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="text-center sm:w-32">
          <div className="text-4xl font-semibold tracking-tight">{app.rating.average.toFixed(1)}</div>
          <RatingStars average={app.rating.average} showValue={false} />
          <div className="mt-1 text-xs text-faint">{formatCount(total)} ratings</div>
        </div>
        <div className="flex-1 space-y-1">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = app.rating.distribution[star - 1] ?? 0;
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={star} className="flex items-center gap-2 text-xs">
                <span className="w-3 text-faint">{star}</span>
                <Icon name="star-fill" size={11} className="text-sysyellow" />
                <div className="h-1.5 flex-1 overflow-hidden rounded-full [background:var(--fill-2)]">
                  <div className="h-full rounded-full bg-sysyellow" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {reviews.length > 0 && (
        <div className="mt-5 space-y-3">
          {reviews.map((r) => (
            <div key={r.id} className="surface-raised rounded-xl p-4">
              <div className="flex items-center gap-2.5">
                <Avatar text={(r.author.name[0] ?? '?').toUpperCase()} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.author.name}</div>
                  <div className="text-2xs text-faint">{formatRelative(r.createdAt)}</div>
                </div>
                <RatingStars average={r.rating} showValue={false} size={12} />
              </div>
              {r.title && <div className="mt-2 text-sm font-semibold">{r.title}</div>}
              {r.body && <p className="mt-1 text-sm leading-snug text-muted">{r.body}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
