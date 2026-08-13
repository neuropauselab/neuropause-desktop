/**
 * Understand — what NeuroPause believes about you, and how to change it.
 *
 * First-run says "you can correct anything now or later". This is *later*.
 * Without it that sentence is a lie, and the profile becomes a thing that was
 * captured once and then quietly hardened into fact — the exact failure mode
 * the provenance model exists to prevent.
 *
 * Three guarantees hold on this screen:
 *  - Every belief shows where it came from, grouped so an INFERENCE can never
 *    be read as something you said.
 *  - An inference becomes a fact only when a person confirms it, and the
 *    promotion keeps the original inference in its source line.
 *  - Derived facts are computed live from real counts and are read-only here;
 *    they change when the data changes, not when someone edits a field.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { ExperienceProfile, UnderstandingAttribute } from '@neuropause/shared';
import {
  ATTRIBUTE_STATUS_LABELS,
  WORKSPACE_TYPE_LABELS,
  groupUnderstanding,
  understandingCoverage,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { Icon } from '@renderer/components/ui/Icon';
import { NoticeBlock } from '@renderer/dataCommandCenter/primitives';
import { TRANSITION, listItemVariants, staggerDelay } from '@renderer/lib/motion';
import { EXPERIENCE_PROFILE_CHANGED } from '@renderer/firstRun/experienceProfileEvents';
import { Skeleton, SkeletonCards, SkeletonRegion } from '@renderer/components/ui/Skeleton';
import { useAnimatedCount } from '@renderer/lib/useAnimatedCount';
import {
  confirmationPatch,
  correctionPatch,
  deriveSystemAttributes,
  isEditable,
  manualAttribute,
} from './understandingModel';

const log = createLogger('understand');

export function UnderstandView(): JSX.Element {
  const [profile, setProfile] = useState<ExperienceProfile | null>(null);
  const [derived, setDerived] = useState<UnderstandingAttribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const next = await ipc.firstRun.get();
      setProfile(next);
    } catch (err) {
      log.warn('Could not read the understanding profile', { message: String(err) });
      setError('Could not read your profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Derived attributes are computed from REAL counts on every load, never
  // stored — a stored derivation goes stale silently and then lies.
  useEffect(() => {
    const at = new Date().toISOString();
    void Promise.allSettled([ipc.data.exportable(), ipc.connectors.list()]).then((results) => {
      const modules =
        results[0].status === 'fulfilled'
          ? results[0].value.map((m) => ({
              moduleId: m.moduleId,
              title: m.title,
              recordCount: m.recordCount,
            }))
          : [];
      const accounts =
        results[1].status === 'fulfilled'
          ? results[1].value.flatMap((c) =>
              c.accounts
                .filter((a) => a.status === 'connected' && a.health === 'healthy')
                .map(() => ({ provider: c.name })),
            )
          : [];
      setDerived(
        deriveSystemAttributes({ populatedModules: modules, connectedAccounts: accounts }, at),
      );
    });
  }, []);

  const all = useMemo(() => [...(profile?.attributes ?? []), ...derived], [profile, derived]);
  // Attributes that came from the PERSON — stated, corrected, or inferred from
  // something they typed. Machine-derived facts deliberately do not count:
  // knowing you have 5 records is not knowing anything about you.
  const userAuthored = (profile?.attributes ?? []).length;
  const [resetFailed, setResetFailed] = useState(false);

  /**
   * Return to first run. The shell decides to show the takeover from the
   * profile state it read at mount, so it is told to re-read rather than left
   * showing a stale "already set up" view until the next launch.
   */
  const restartSetup = async (): Promise<void> => {
    setBusyKey('reset');
    setResetFailed(false);
    try {
      await ipc.firstRun.reset();
      window.dispatchEvent(new CustomEvent(EXPERIENCE_PROFILE_CHANGED));
    } catch (err) {
      log.warn('Could not reopen setup', { message: String(err) });
      setResetFailed(true);
    } finally {
      setBusyKey(null);
    }
  };
  const groups = useMemo(() => groupUnderstanding(all), [all]);
  const coverage = useMemo(() => understandingCoverage(all), [all]);

  const write = async (
    patch: Parameters<typeof ipc.firstRun.set>[0],
    key: string,
  ): Promise<void> => {
    setBusyKey(key);
    setError(null);
    try {
      setProfile(await ipc.firstRun.set(patch));
    } catch (err) {
      log.warn('Could not write the understanding profile', { message: String(err) });
      setError('That change did not save.');
    } finally {
      setBusyKey(null);
    }
  };

  const saveCorrection = async (attribute: UnderstandingAttribute): Promise<void> => {
    const at = new Date().toISOString();
    await write({ attributes: [correctionPatch(attribute, draft, at)] }, attribute.key);
    setEditing(null);
    setDraft('');
  };

  const addAttribute = async (): Promise<void> => {
    if (!newLabel.trim() || !newValue.trim()) return;
    const at = new Date().toISOString();
    await write({ attributes: [manualAttribute(newLabel, newValue, at)] }, 'new');
    setAdding(false);
    setNewLabel('');
    setNewValue('');
  };

  return (
    <ViewScroll max={880}>
      <ViewHeader
        title="What NeuroPause understands"
        subtitle="A model of what you have told it — not objective truth. Every line shows where it came from, and you can correct or remove anything."
        right={
          <Button icon="plus" onClick={() => setAdding((v) => !v)} disabled={loading}>
            Add
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <NoticeBlock icon="info">{error}</NoticeBlock>
        </div>
      )}

      {loading ? (
        <SkeletonRegion label="Loading what NeuroPause understands">
          <div className="mb-5 rounded-2xl border border-[var(--hairline)] px-5 py-4">
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <Skeleton className="h-2.5 w-24" />
                  <Skeleton className="mt-2 h-5 w-8" />
                </div>
              ))}
            </div>
          </div>
          <SkeletonCards count={3} lines={1} />
        </SkeletonRegion>
      ) : (
        <>
          <Card variant="hairline" className="mb-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              {/*
                These three DO change while the user is looking at them —
                confirming an inference moves one figure down and another up —
                so a short roll shows which way the change went. They never
                animate on load: the first render is the number, immediately.
              */}
              <CountFigure label="Things known" value={coverage.total} />
              <CountFigure label="Confirmed by you" value={coverage.confirmed} />
              <CountFigure
                label="Awaiting confirmation"
                value={coverage.awaitingConfirmation}
                tone={coverage.awaitingConfirmation > 0 ? 'warn' : undefined}
              />
              {profile?.workspaceType && (
                <Figure label="Context" value={WORKSPACE_TYPE_LABELS[profile.workspaceType]} />
              )}
            </div>
          </Card>

          <AnimatePresence initial={false}>
            {adding && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={TRANSITION.quick}
                className="overflow-hidden"
              >
                <Card variant="hairline" className="mb-5">
                  <h3 className="mb-3 text-sm font-semibold">Tell NeuroPause something</h3>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="Label — e.g. Main market"
                      aria-label="Label"
                      className="h-9 flex-1 rounded-lg border border-[var(--hairline)] bg-transparent px-3 text-sm outline-none focus:border-accent/60"
                    />
                    <input
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      placeholder="Value — e.g. Germany and Austria"
                      aria-label="Value"
                      className="h-9 flex-[2] rounded-lg border border-[var(--hairline)] bg-transparent px-3 text-sm outline-none focus:border-accent/60"
                    />
                    <Button
                      variant="primary"
                      onClick={() => void addAttribute()}
                      disabled={busyKey === 'new' || !newLabel.trim() || !newValue.trim()}
                    >
                      Save
                    </Button>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/*
            The condition is deliberately NOT `all.length === 0`.

            Derived attributes (record counts, connected accounts) appear on a
            fresh install with no user input at all, so a total-count check
            silently stops firing and the screen shows a wall of machine facts
            with no acknowledgement that the person has never been asked
            anything. What matters is whether NeuroPause has been TOLD
            anything — and if not, saying so plus offering the way back is the
            whole job of this screen.
          */}
          {userAuthored === 0 && (
            <div className="rounded-2xl border border-[var(--hairline)] px-4 py-4">
              <h3 className="text-sm font-semibold">
                You haven&rsquo;t told NeuroPause anything yet
              </h3>
              <p className="mt-1 max-w-[560px] text-sm leading-relaxed text-muted">
                {derived.length > 0
                  ? 'Everything below is counted from your own records and connections — useful, but it is not the same as knowing what you are trying to do. Answer a few questions and suggestions get relevant to your actual work.'
                  : 'Nothing is being assumed in the meantime. Answer a few questions, or add a single fact, and suggestions get relevant to your actual work.'}
              </p>
              <div className="mt-3.5 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={() => void restartSetup()}
                  disabled={busyKey === 'reset'}
                  loading={busyKey === 'reset'}
                >
                  Answer the setup questions
                </Button>
                <Button icon="plus" onClick={() => setAdding(true)} disabled={busyKey === 'reset'}>
                  Add one thing instead
                </Button>
              </div>
              {resetFailed && (
                <p className="mt-2.5 text-xs text-syspink">
                  Setup could not be reopened. You can still add facts directly with Add.
                </p>
              )}
            </div>
          )}

          {groups.map((group) => (
            <section key={group.id} className="mb-6">
              <h2 className="text-sm font-semibold">{group.label}</h2>
              <p className="mb-2.5 mt-0.5 max-w-[620px] text-xs text-faint">{group.blurb}</p>
              <div className="space-y-2">
                <AnimatePresence initial={false} mode="popLayout">
                  {group.attributes.map((a, i) => (
                    <motion.div
                      key={a.key}
                      layout
                      variants={listItemVariants}
                      initial="initial"
                      animate="animate"
                      exit={{ opacity: 0, scale: 0.98, transition: TRANSITION.exit }}
                      transition={{ ...TRANSITION.quick, delay: staggerDelay(i) }}
                    >
                      <Card variant="hairline" className="!py-3">
                        {editing === a.key ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              aria-label={`Correct ${a.label}`}
                              autoFocus
                              className="h-9 min-w-[200px] flex-1 rounded-lg border border-[var(--hairline)] bg-transparent px-3 text-sm outline-none focus:border-accent/60"
                            />
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => void saveCorrection(a)}
                              disabled={busyKey === a.key}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => setEditing(null)}
                              disabled={busyKey === a.key}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-xs uppercase tracking-wider text-faint">
                                {a.label}
                              </div>
                              <div className="mt-0.5 text-sm font-medium">{a.value}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
                                <ProvenanceBadge status={a.status} />
                                <span className="min-w-0">{a.source}</span>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {a.status === 'inferred' && (
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() =>
                                    void write(
                                      {
                                        attributes: [
                                          confirmationPatch(a, new Date().toISOString()),
                                        ],
                                      },
                                      a.key,
                                    )
                                  }
                                  disabled={busyKey === a.key}
                                >
                                  Confirm
                                </Button>
                              )}
                              {isEditable(a) && (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      setEditing(a.key);
                                      setDraft(a.value);
                                    }}
                                    disabled={busyKey === a.key}
                                  >
                                    Correct
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => void write({ removeKeys: [a.key] }, a.key)}
                                    disabled={busyKey === a.key}
                                  >
                                    Forget
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          ))}

          <NoticeBlock icon="shield">
            This profile stays on this device. NeuroPause uses it to make suggestions relevant — it
            never treats an inference as a fact, and nothing here is sent anywhere by reading this
            screen.
          </NoticeBlock>
        </>
      )}
    </ViewScroll>
  );
}

function ProvenanceBadge({ status }: { status: UnderstandingAttribute['status'] }): JSX.Element {
  const warn = status === 'inferred';
  return (
    <span
      className={
        warn
          ? 'inline-flex items-center gap-1 rounded-full border border-sysorange/40 px-2 py-0.5 text-[11px] font-medium text-sysorange'
          : 'inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[11px] font-medium text-muted'
      }
    >
      {warn && <Icon name="info" size={10} />}
      {ATTRIBUTE_STATUS_LABELS[status]}
    </span>
  );
}

/** A figure whose value rolls when it CHANGES. See useAnimatedCount. */
function CountFigure({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'warn';
}): JSX.Element {
  const shown = useAnimatedCount(value);
  return <Figure label={label} value={shown.toLocaleString()} tone={tone} />;
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn';
}): JSX.Element {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-faint">{label}</div>
      <div
        className={
          tone === 'warn'
            ? 'mt-0.5 text-lg font-semibold text-sysorange'
            : 'mt-0.5 text-lg font-semibold'
        }
      >
        {value}
      </div>
    </div>
  );
}
